import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  deriveRatingProgression,
  getRatingTier,
  INITIAL_RATING,
  type RatingProgressEntryLike,
} from '@/lib/ratingSystem';
import type { EvaluationResult, LeaderboardEntry } from '@/types';
import type { VerifiedFirebaseUser } from './verifyFirebaseToken';

export interface ServiceAccountCreds {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface ServerDatastoreAuthContext {
  projectId: string;
  accessToken: string;
}

interface CachedAccessToken {
  accessToken: string;
  expiresAtMs: number;
}

const DEFAULT_PROJECT_ID = 'judge-system-9837a';
const REST_TIMEOUT_MS = 4_500;
const MAX_OCC_RETRIES = 3;

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function fetchFirestoreWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Single-Responsibility Google Service Account OAuth2 Token Provider with
 * cached token reuse, singleflight cold-start deduplication, and network timeouts.
 * Supports `FIREBASE_SERVICE_ACCOUNT_JSON` on Vercel, `FIREBASE_ACCESS_TOKEN` in CI,
 * and local `firebase-tools` CLI tokens during local development.
 */
export class ServiceAccountTokenProvider {
  private cachedToken: CachedAccessToken | null = null;
  private inFlightToken: Promise<string> | null = null;
  private readonly credsResolver: () => ServiceAccountCreds | null;

  public constructor(credsResolver?: () => ServiceAccountCreds | null) {
    this.credsResolver =
      credsResolver ?? (() => ServiceAccountTokenProvider.parseEnvCredentials());
  }

  public static parseEnvCredentials(): ServiceAccountCreds | null {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<ServiceAccountCreds>;
      if (
        typeof parsed.project_id === 'string' &&
        typeof parsed.client_email === 'string' &&
        typeof parsed.private_key === 'string'
      ) {
        return {
          project_id: parsed.project_id,
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  public static resolveDefaultProjectId(): string {
    return (
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
      process.env.FIREBASE_PROJECT_ID?.trim() ||
      DEFAULT_PROJECT_ID
    );
  }

  private readLocalCliAccessToken(): string | null {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true'
    ) {
      return null;
    }
    try {
      const cliConfigPath = path.join(
        homedir(),
        '.config',
        'configstore',
        'firebase-tools.json'
      );
      if (!existsSync(cliConfigPath)) return null;
      const cfg = JSON.parse(readFileSync(cliConfigPath, 'utf8')) as {
        tokens?: { access_token?: string; expires_at?: number };
      };
      const token = cfg?.tokens?.access_token;
      const expiresAt = Number(cfg?.tokens?.expires_at ?? 0);
      if (token && (!expiresAt || expiresAt > Date.now() + 30_000)) {
        return token;
      }
      return null;
    } catch {
      return null;
    }
  }

  public isConfigured(): boolean {
    if (this.credsResolver() !== null) return true;
    if (Boolean(process.env.FIREBASE_ACCESS_TOKEN?.trim())) return true;
    return this.readLocalCliAccessToken() !== null;
  }

  public getCredentials(): ServiceAccountCreds | null {
    return this.credsResolver();
  }

  public async resolveAuthContext(): Promise<ServerDatastoreAuthContext | null> {
    const creds = this.credsResolver();
    if (creds) {
      const accessToken = await this.getAccessToken(creds);
      return { projectId: creds.project_id, accessToken };
    }

    const explicitToken = process.env.FIREBASE_ACCESS_TOKEN?.trim();
    if (explicitToken) {
      return {
        projectId: ServiceAccountTokenProvider.resolveDefaultProjectId(),
        accessToken: explicitToken,
      };
    }

    const localCliToken = this.readLocalCliAccessToken();
    if (localCliToken) {
      return {
        projectId: ServiceAccountTokenProvider.resolveDefaultProjectId(),
        accessToken: localCliToken,
      };
    }

    return null;
  }

  public async getAccessToken(creds: ServiceAccountCreds): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs > now + 30_000) {
      return this.cachedToken.accessToken;
    }

    if (!this.inFlightToken) {
      this.inFlightToken = this.mintAccessToken(creds)
        .then((entry) => {
          this.cachedToken = entry;
          return entry.accessToken;
        })
        .finally(() => {
          this.inFlightToken = null;
        });
    }

    return this.inFlightToken;
  }

  private async mintAccessToken(
    creds: ServiceAccountCreds
  ): Promise<CachedAccessToken> {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claimSet = base64UrlEncode(
      JSON.stringify({
        iss: creds.client_email,
        sub: creds.client_email,
        aud: 'https://oauth2.googleapis.com/token',
        scope: 'https://www.googleapis.com/auth/datastore',
        iat: nowSec,
        exp: nowSec + 3600,
      })
    );

    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claimSet}`);
    signer.end();
    const signature = base64UrlEncode(signer.sign(creds.private_key));
    const assertion = `${header}.${claimSet}.${signature}`;

    const tokenRes = await fetchFirestoreWithTimeout(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
        cache: 'no-store',
      }
    );

    if (!tokenRes.ok) {
      throw new Error(`Service account OAuth exchange failed (${tokenRes.status})`);
    }

    const data = (await tokenRes.json()) as {
      access_token: string;
      expires_in?: number;
    };
    return {
      accessToken: data.access_token,
      expiresAtMs: now + (data.expires_in ?? 3600) * 1000,
    };
  }
}

export function derivePublicContestantHandle(user: VerifiedFirebaseUser): string {
  if (user.name && user.name.trim().length > 0) {
    return user.name.trim().slice(0, 40);
  }
  if (user.email && user.email.includes('@')) {
    return user.email.split('@')[0].slice(0, 32);
  }
  return `coder_${user.uid.slice(0, 6)}`;
}

/**
 * Server-Authoritative Leaderboard Repository using Optimistic Concurrency Control
 * (`currentDocument.updateTime` / `currentDocument.exists=false`) to prevent
 * concurrent lost-update race conditions across parallel submissions.
 */
export class AuthoritativeLeaderboardRepository {
  private readonly tokenProvider: ServiceAccountTokenProvider;

  public constructor(tokenProvider?: ServiceAccountTokenProvider) {
    this.tokenProvider = tokenProvider ?? new ServiceAccountTokenProvider();
  }

  public isServerWriteConfigured(): boolean {
    return this.tokenProvider.isConfigured();
  }

  public async syncEntry(
    user: VerifiedFirebaseUser,
    evaluation: EvaluationResult
  ): Promise<boolean> {
    if (user.uid === 'dev-local-user') return false;
    const authCtx = await this.tokenProvider.resolveAuthContext();
    if (!authCtx) return false;

    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${authCtx.projectId}/databases/(default)/documents`;
      const headers = {
        Authorization: `Bearer ${authCtx.accessToken}`,
        'Content-Type': 'application/json',
      };

      const lbDocUrl = `${baseUrl}/leaderboard/${encodeURIComponent(user.uid)}`;
      const handle = derivePublicContestantHandle(user);
      let bestProblemScore = evaluation.score.totalScore;
      let isAc = evaluation.score.verdict === 'AC';
      const nowIso = new Date().toISOString();

      for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt += 1) {
        const existingRes = await fetchFirestoreWithTimeout(lbDocUrl, {
          headers,
          cache: 'no-store',
        });

        const problemScores: Record<string, { score: number; ac: boolean }> = {};
        let existingUpdateTime: string | null = null;

        if (existingRes.ok) {
          const docJson = (await existingRes.json()) as {
            updateTime?: string;
            fields?: {
              problemScoresJson?: { stringValue?: string };
            };
          };
          existingUpdateTime = docJson.updateTime ?? null;
          const rawJson = docJson.fields?.problemScoresJson?.stringValue;
          if (rawJson) {
            try {
              Object.assign(problemScores, JSON.parse(rawJson));
            } catch {
              // Ignore malformed legacy field
            }
          }
        } else if (existingRes.status !== 404) {
          return false;
        }

        const prev = problemScores[evaluation.problemId];
        isAc = evaluation.score.verdict === 'AC' || Boolean(prev?.ac);
        bestProblemScore = Math.max(
          prev?.score ?? 0,
          evaluation.score.totalScore
        );
        problemScores[evaluation.problemId] = {
          score: bestProblemScore,
          ac: isAc,
        };

        let acceptedCount = 0;
        let attemptedCount = 0;
        let totalBestScore = 0;
        for (const entry of Object.values(problemScores)) {
          attemptedCount += 1;
          if (entry.ac) acceptedCount += 1;
          totalBestScore += entry.score;
        }

        const occQuery = existingUpdateTime
          ? `?currentDocument.updateTime=${encodeURIComponent(existingUpdateTime)}`
          : `?currentDocument.exists=false`;

        const patchRes = await fetchFirestoreWithTimeout(`${lbDocUrl}${occQuery}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            fields: {
              uid: { stringValue: user.uid },
              handle: { stringValue: handle },
              photoURL: user.picture
                ? { stringValue: user.picture.slice(0, 2048) }
                : { nullValue: null },
              acceptedCount: { integerValue: String(acceptedCount) },
              attemptedCount: { integerValue: String(attemptedCount) },
              totalBestScore: { integerValue: String(totalBestScore) },
              problemScoresJson: { stringValue: JSON.stringify(problemScores) },
              updatedAtIso: { stringValue: nowIso },
            },
          }),
          cache: 'no-store',
        });

        if (patchRes.ok) {
          break;
        }
        if (patchRes.status !== 409 && patchRes.status !== 412) {
          return false;
        }
        if (attempt === MAX_OCC_RETRIES - 1) {
          return false;
        }
      }

      const probLbUrl = `${baseUrl}/problemLeaderboards/${encodeURIComponent(
        evaluation.problemId
      )}/entries/${encodeURIComponent(user.uid)}`;
      await fetchFirestoreWithTimeout(probLbUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          fields: {
            uid: { stringValue: user.uid },
            handle: { stringValue: handle },
            bestScore: { integerValue: String(bestProblemScore) },
            verdict: { stringValue: isAc ? 'AC' : evaluation.score.verdict },
            updatedAtIso: { stringValue: nowIso },
          },
        }),
        cache: 'no-store',
      });

      return true;
    } catch (err) {
      console.error('[AuthoritativeLeaderboardRepository.syncEntry] error:', err);
      return false;
    }
  }

  /**
   * Public standings. Only architects who have solved at least one problem are
   * listed; an account with attempts but no Accepted verdict is not ranked.
   */
  public async fetchGlobalStandings(limitCount = 50): Promise<LeaderboardEntry[]> {
    const projectId = ServiceAccountTokenProvider.resolveDefaultProjectId();
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? '';
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery${
      apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''
    }`;
    const cappedLimit = Math.max(1, Math.min(100, limitCount));

    try {
      const res = await fetchFirestoreWithTimeout(queryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'leaderboard' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'acceptedCount' },
                op: 'GREATER_THAN',
                value: { integerValue: '0' },
              },
            },
            // A range filter must be ordered on its own field first; ordering by
            // points happens below. Most-solved first keeps the cut-off sensible.
            orderBy: [
              {
                field: { fieldPath: 'acceptedCount' },
                direction: 'DESCENDING',
              },
            ],
            limit: 100,
          },
        }),
        next: { revalidate: 15 },
      } as RequestInit);

      if (!res.ok) return [];

      const rows = (await res.json()) as Array<{
        document?: {
          fields?: {
            uid?: { stringValue?: string };
            handle?: { stringValue?: string };
            photoURL?: { stringValue?: string; nullValue?: null };
            rating?: { integerValue?: string; doubleValue?: number };
            rankTitle?: { stringValue?: string };
            acceptedCount?: { integerValue?: string };
            attemptedCount?: { integerValue?: string };
            totalBestScore?: { integerValue?: string };
            problemScoresJson?: { stringValue?: string };
            updatedAtIso?: { stringValue?: string };
          };
        };
      }>;

      const entries: LeaderboardEntry[] = [];
      for (const row of rows) {
        const parsed = AuthoritativeLeaderboardRepository.decodeLeaderboardFields(
          row.document?.fields
        );
        if (parsed && parsed.acceptedCount >= 1) entries.push(parsed);
      }
      entries.sort(
        (a, b) =>
          b.totalBestScore - a.totalBestScore || b.acceptedCount - a.acceptedCount
      );
      return entries.slice(0, cappedLimit);
    } catch (err) {
      console.error('[AuthoritativeLeaderboardRepository.fetchGlobalStandings] error:', err);
      return [];
    }
  }

  /** One architect's public card. Like the standings, only for solvers. */
  public async fetchPublicEntryByUid(uid: string): Promise<LeaderboardEntry | null> {
    const cleanUid = uid.trim();
    if (!cleanUid || cleanUid.length > 128) return null;
    const projectId = ServiceAccountTokenProvider.resolveDefaultProjectId();
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? '';
    const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/leaderboard/${encodeURIComponent(
      cleanUid
    )}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;

    try {
      const res = await fetchFirestoreWithTimeout(docUrl, {
        method: 'GET',
        next: { revalidate: 15 },
      } as RequestInit);
      if (!res.ok) return null;
      const docJson = (await res.json()) as {
        fields?: Record<string, unknown>;
      };
      const entry = AuthoritativeLeaderboardRepository.decodeLeaderboardFields(
        docJson.fields as Parameters<
          typeof AuthoritativeLeaderboardRepository.decodeLeaderboardFields
        >[0]
      );
      return entry && entry.acceptedCount >= 1 ? entry : null;
    } catch {
      return null;
    }
  }

  private static decodeLeaderboardFields(
    f?: {
      uid?: { stringValue?: string };
      handle?: { stringValue?: string };
      photoURL?: { stringValue?: string; nullValue?: null };
      rating?: { integerValue?: string; doubleValue?: number };
      rankTitle?: { stringValue?: string };
      acceptedCount?: { integerValue?: string };
      attemptedCount?: { integerValue?: string };
      totalBestScore?: { integerValue?: string };
      problemScoresJson?: { stringValue?: string };
      updatedAtIso?: { stringValue?: string };
    }
  ): LeaderboardEntry | null {
    if (!f?.uid?.stringValue) return null;

    let problemScores: Record<string, { score: number; ac: boolean }> | undefined;
    if (f.problemScoresJson?.stringValue) {
      try {
        problemScores = JSON.parse(f.problemScoresJson.stringValue) as Record<
          string,
          { score: number; ac: boolean }
        >;
      } catch {
        problemScores = undefined;
      }
    }

    const explicitRating = Number(
      f.rating?.integerValue ?? f.rating?.doubleValue ?? NaN
    );
    let rating =
      Number.isFinite(explicitRating) && explicitRating > 0
        ? Math.round(explicitRating)
        : INITIAL_RATING;

    if (
      (!Number.isFinite(explicitRating) || explicitRating <= 0) &&
      problemScores
    ) {
      const progressLike: Record<string, RatingProgressEntryLike> = {};
      let i = 0;
      for (const [pid, val] of Object.entries(problemScores)) {
        i += 1;
        progressLike[pid] = {
          status: val.ac ? 'ac' : 'tried',
          bestScore: val.score,
          lastSubmittedAtMs: Date.now() - i * 60_000,
        };
      }
      rating = deriveRatingProgression(progressLike, null, null).currentRating;
    }

    const tier = getRatingTier(rating);

    return {
      uid: f.uid.stringValue,
      handle: f.handle?.stringValue || 'System Architect',
      photoURL: f.photoURL?.stringValue ?? null,
      rating,
      rankTitle: f.rankTitle?.stringValue || tier.title,
      acceptedCount: Number(f.acceptedCount?.integerValue ?? 0),
      attemptedCount: Number(f.attemptedCount?.integerValue ?? 0),
      totalBestScore: Number(f.totalBestScore?.integerValue ?? 0),
      problemScores,
      updatedAtIso: f.updatedAtIso?.stringValue ?? '',
    };
  }
}

export const defaultTokenProvider = new ServiceAccountTokenProvider();
const defaultLeaderboardRepository = new AuthoritativeLeaderboardRepository(
  defaultTokenProvider
);

export function isCompetitiveServerWriteConfigured(): boolean {
  return defaultLeaderboardRepository.isServerWriteConfigured();
}

export async function syncAuthoritativeLeaderboardEntry(
  user: VerifiedFirebaseUser,
  evaluation: EvaluationResult
): Promise<boolean> {
  return defaultLeaderboardRepository.syncEntry(user, evaluation);
}

export async function fetchGlobalLeaderboard(
  limitCount = 50
): Promise<LeaderboardEntry[]> {
  return defaultLeaderboardRepository.fetchGlobalStandings(limitCount);
}

export async function fetchPublicLeaderboardEntry(
  uid: string
): Promise<LeaderboardEntry | null> {
  return defaultLeaderboardRepository.fetchPublicEntryByUid(uid);
}
