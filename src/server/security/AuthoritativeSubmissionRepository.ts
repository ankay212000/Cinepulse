import {
  computeStatsFromProgress,
  deriveActivityMapWithFallback,
  incrementActivityOnDate,
  type ProblemProgressSummaryEntry,
  sanitizeSnapshot,
  SCHEMA_LIMITS,
} from '@/lib/dbSchema';
import {
  applyRatingUpdateForSubmission,
  type RatingHistoryPoint,
  type RatingProblemMeta,
} from '@/lib/ratingSystem';
import { listPublicProblemSummaries } from '@/server/problems/catalog';
import {
  FirestoreRestCodec,
  type FirestoreRestValue,
} from '@/server/problems/dbCatalog';
import type { EvaluationResult, VerdictCode } from '@/types';
import {
  defaultTokenProvider,
  derivePublicContestantHandle,
  fetchFirestoreWithTimeout,
  type ServiceAccountTokenProvider,
} from './firestoreRestAdmin';
import type { VerifiedFirebaseUser } from './verifyFirebaseToken';

const SAFE_DOC_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/;
const MAX_OCC_RETRIES = 3;

export interface ServerSubmissionPersistResult {
  persistedUserState: boolean;
  leaderboardSynced: boolean;
  /**
   * Short diagnostic code set only when nothing was recorded, e.g.
   * `write_http_403`. Never contains credentials or user data; the client shows
   * it next to the "result was not saved" warning so a failure can be reported.
   */
  failureReason?: string;
}

function notRecorded(failureReason: string): ServerSubmissionPersistResult {
  return { persistedUserState: false, leaderboardSynced: false, failureReason };
}

/**
 * True when a commit was rejected only because a document changed between our read
 * and our write, so reading again and retrying can succeed.
 *
 * A stale `currentDocument.updateTime` is answered with HTTP 400 and
 * `FAILED_PRECONDITION` (not 409), and the browser changes these documents on its
 * own: draft autosave, the profile refresh on page load, the canvas-height
 * preference. Treating that 400 as fatal dropped the whole result.
 */
async function isRetryableWriteConflict(res: Response): Promise<boolean> {
  if (res.status === 409 || res.status === 412) return true;
  if (res.status !== 400) return false;
  try {
    const body = (await res.clone().json()) as {
      error?: { status?: string };
    };
    return body?.error?.status === 'FAILED_PRECONDITION';
  } catch {
    return false;
  }
}

/**
 * Firestore's own error status and message from a failed REST call. Written to the
 * server log only (it can name document paths), never sent to the browser.
 */
async function describeFirestoreError(res: Response): Promise<string> {
  try {
    const parsed = (await res.clone().json()) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const error = (
      first as { error?: { status?: unknown; message?: unknown } } | null
    )?.error;
    const status = typeof error?.status === 'string' ? error.status : '';
    const message =
      typeof error?.message === 'string' ? error.message.slice(0, 300) : '';
    return [status, message].filter(Boolean).join(': ');
  } catch {
    return '';
  }
}

interface BatchGetEntry {
  found?: {
    name: string;
    fields?: Record<string, FirestoreRestValue>;
    updateTime?: string;
  };
  missing?: string;
}

/**
 * Single-Responsibility encoder converting plain domain primitives, arrays, maps,
 * and ISO timestamps into Firestore REST v1 `Value` wire envelopes.
 */
export class FirestoreRestValueEncoder {
  public encode(val: unknown): FirestoreRestValue {
    if (val === null || val === undefined) {
      return { nullValue: null };
    }
    if (typeof val === 'boolean') {
      return { booleanValue: val };
    }
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) return { integerValue: '0' };
      if (Number.isInteger(val)) {
        return { integerValue: String(val) };
      }
      return { doubleValue: val };
    }
    if (typeof val === 'string') {
      return { stringValue: val };
    }
    if (Array.isArray(val)) {
      return {
        arrayValue: {
          values: val.map((item) => this.encode(item)),
        },
      };
    }
    if (typeof val === 'object') {
      const record = val as Record<string, unknown>;
      if ('__firestoreTimestampIso' in record && typeof record.__firestoreTimestampIso === 'string') {
        return { timestampValue: record.__firestoreTimestampIso };
      }
      const fields: Record<string, FirestoreRestValue> = {};
      for (const [k, v] of Object.entries(record)) {
        if (v !== undefined) {
          fields[k] = this.encode(v);
        }
      }
      return { mapValue: { fields } };
    }
    return { nullValue: null };
  }

  public encodeFields(obj: Record<string, unknown>): Record<string, FirestoreRestValue> {
    const out: Record<string, FirestoreRestValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        out[k] = this.encode(v);
      }
    }
    return out;
  }

  public timestamp(isoString: string): { __firestoreTimestampIso: string } {
    return { __firestoreTimestampIso: isoString };
  }
}

/**
 * Server-Authoritative Submission & Progress Repository.
 *
 * Atomically persists the competitive state documents inside `/api/judge/evaluate`:
 *   1. `/users/{uid}` (`stats`, `progressSummary`, `activityByDate`)
 *   2. `/users/{uid}/problemStates/{problemId}` (`bestScore`, `bestVerdict`, `runsCount`, `draft`)
 *   3. `/users/{uid}/problemStates/{problemId}/submissions/{submissionId}` (append-only run record)
 *   4. `/leaderboard/{uid}` (global standings)
 *   5. `/problemLeaderboards/{problemId}/entries/{uid}` (per-problem standings)
 *
 * Documents 4 and 5 are public, and are written only once the account has solved at
 * least one problem. An account with attempts but no Accepted verdict is recorded in
 * documents 1-3 only and has no leaderboard document at all.
 *
 * Uses a single `documents:batchGet` + atomic `documents:commit` with Optimistic Concurrency
 * Control (`currentDocument.updateTime` / `exists: false`) so clients never need write access
 * to `/submissions`, `progressSummary`, `stats`, or `bestVerdict`.
 */
export class AuthoritativeSubmissionRepository {
  private readonly tokenProvider: ServiceAccountTokenProvider;
  private readonly codec: FirestoreRestCodec;
  private readonly encoder: FirestoreRestValueEncoder;
  private readonly fetcher: typeof fetchFirestoreWithTimeout;

  public constructor(deps?: {
    tokenProvider?: ServiceAccountTokenProvider;
    codec?: FirestoreRestCodec;
    encoder?: FirestoreRestValueEncoder;
    fetcher?: typeof fetchFirestoreWithTimeout;
  }) {
    this.tokenProvider = deps?.tokenProvider ?? defaultTokenProvider;
    this.codec = deps?.codec ?? new FirestoreRestCodec();
    this.encoder = deps?.encoder ?? new FirestoreRestValueEncoder();
    this.fetcher = deps?.fetcher ?? fetchFirestoreWithTimeout;
  }

  public async persistEvaluation(
    user: VerifiedFirebaseUser,
    evaluation: EvaluationResult
  ): Promise<ServerSubmissionPersistResult> {
    if (user.uid === 'dev-local-user') {
      return notRecorded('dev_test_account');
    }

    const problemId = evaluation.problemId;
    const safeSubId = evaluation.submissionId.slice(0, 120);
    if (
      !SAFE_DOC_ID_RE.test(user.uid) ||
      !SAFE_DOC_ID_RE.test(problemId) ||
      !SAFE_DOC_ID_RE.test(safeSubId)
    ) {
      return notRecorded('invalid_ids');
    }

    // A credential problem must not turn a judged result into an HTTP 500: the
    // result is still returned, flagged as not recorded.
    let authCtx: Awaited<
      ReturnType<ServiceAccountTokenProvider['resolveAuthContext']>
    >;
    try {
      authCtx = await this.tokenProvider.resolveAuthContext();
    } catch (err) {
      console.error(
        '[AuthoritativeSubmissionRepository.persistEvaluation] server credentials rejected:',
        err
      );
      return notRecorded('server_credentials_rejected');
    }
    if (!authCtx) {
      return notRecorded('server_credentials_missing');
    }

    const docPrefix = `projects/${authCtx.projectId}/databases/(default)/documents`;
    const apiBase = `https://firestore.googleapis.com/v1/${docPrefix}`;
    const headers = {
      Authorization: `Bearer ${authCtx.accessToken}`,
      'Content-Type': 'application/json',
    };

    const userDocName = `${docPrefix}/users/${user.uid}`;
    const probStateDocName = `${docPrefix}/users/${user.uid}/problemStates/${problemId}`;
    const subDocName = `${probStateDocName}/submissions/${safeSubId}`;
    const lbDocName = `${docPrefix}/leaderboard/${user.uid}`;
    const probLbDocName = `${docPrefix}/problemLeaderboards/${problemId}/entries/${user.uid}`;

    const cleanSnap = sanitizeSnapshot(evaluation.snapshot);
    const parsedMs = Date.parse(evaluation.submittedAtIso);
    const submittedAtMs =
      Number.isFinite(parsedMs) && parsedMs > 0 ? Math.round(parsedMs) : Date.now();
    const submittedAtIso = new Date(submittedAtMs).toISOString();
    const nowIso = new Date().toISOString();
    const handle = derivePublicContestantHandle(user);

    try {
      for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt += 1) {
        const batchGetRes = await this.fetcher(`${apiBase}:batchGet`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            documents: [userDocName, probStateDocName, lbDocName],
          }),
          cache: 'no-store',
        });

        if (!batchGetRes.ok) {
          console.error(
            `[AuthoritativeSubmissionRepository.persistEvaluation] batchGet failed (${batchGetRes.status}) ${await describeFirestoreError(batchGetRes)}`
          );
          return notRecorded(`read_http_${batchGetRes.status}`);
        }

        const batchEntries = (await batchGetRes.json()) as BatchGetEntry[];
        const foundByName = new Map<
          string,
          NonNullable<BatchGetEntry['found']>
        >();
        for (const entry of batchEntries) {
          if (entry.found?.name) {
            foundByName.set(entry.found.name, entry.found);
          }
        }

        const existingUserDoc = foundByName.get(userDocName);
        const existingProbDoc = foundByName.get(probStateDocName);
        const existingLbDoc = foundByName.get(lbDocName);

        const decodedUser = this.decodeFieldsMap(existingUserDoc?.fields);
        const decodedProb = this.decodeFieldsMap(existingProbDoc?.fields);

        const prevProgressRaw =
          decodedUser.progressSummary &&
          typeof decodedUser.progressSummary === 'object' &&
          !Array.isArray(decodedUser.progressSummary)
            ? (decodedUser.progressSummary as Record<
                string,
                ProblemProgressSummaryEntry
              >)
            : {};

        const prevSummary = prevProgressRaw[problemId];
        const prevProbBestScore =
          typeof decodedProb.bestScore === 'number' ? decodedProb.bestScore : 0;
        const prevProbBestVerdict =
          typeof decodedProb.bestVerdict === 'string'
            ? (decodedProb.bestVerdict as VerdictCode)
            : null;
        const prevProbRunsCount =
          typeof decodedProb.runsCount === 'number' ? decodedProb.runsCount : 0;

        const prevBestScore = Math.max(
          prevSummary?.bestScore ?? 0,
          prevProbBestScore
        );
        const prevRunsCount = Math.max(
          prevSummary?.runsCount ?? 0,
          prevProbRunsCount
        );
        const prevWasAc =
          prevSummary?.status === 'ac' || prevProbBestVerdict === 'AC';

        const evalTotalScore = Math.round(evaluation.score.totalScore);
        const isNewAc = evaluation.score.verdict === 'AC';
        const nextStatus: 'ac' | 'tried' = prevWasAc || isNewAc ? 'ac' : 'tried';
        const nextBestScore = Math.max(prevBestScore, evalTotalScore);
        const nextBestVerdict: VerdictCode =
          nextStatus === 'ac'
            ? 'AC'
            : evalTotalScore >= prevBestScore
              ? evaluation.score.verdict
              : (prevSummary?.bestVerdict ??
                prevProbBestVerdict ??
                evaluation.score.verdict);
        const nextRunsCount = prevRunsCount + 1;

        const nextProgressSummary: Record<string, ProblemProgressSummaryEntry> = {
          ...prevProgressRaw,
        };
        if (
          !(problemId in nextProgressSummary) &&
          Object.keys(nextProgressSummary).length >= SCHEMA_LIMITS.maxProgressEntries
        ) {
          const oldestKey = Object.entries(nextProgressSummary).sort(
            (a, b) =>
              (a[1]?.lastSubmittedAtMs ?? 0) - (b[1]?.lastSubmittedAtMs ?? 0)
          )[0]?.[0];
          if (oldestKey) delete nextProgressSummary[oldestKey];
        }

        const firstSolvedAtMs =
          nextStatus === 'ac'
            ? (prevSummary?.firstSolvedAtMs ??
              (prevWasAc ? prevSummary?.lastSubmittedAtMs : undefined) ??
              submittedAtMs)
            : undefined;

        nextProgressSummary[problemId] = {
          status: nextStatus,
          bestScore: nextBestScore,
          bestVerdict: nextBestVerdict,
          runsCount: nextRunsCount,
          lastSubmittedAtMs: submittedAtMs,
          ...(firstSolvedAtMs ? { firstSolvedAtMs } : {}),
        };

        const problemMetaLookup = new Map<string, RatingProblemMeta>(
          listPublicProblemSummaries().map((p) => [
            p.id,
            {
              id: p.id,
              code: p.code,
              title: p.title,
              difficulty: p.difficulty,
              maxPoints: p.maxPoints,
            },
          ])
        );

        const ratingUpdate = applyRatingUpdateForSubmission({
          prevProgressSummary: prevProgressRaw,
          nextProgressSummary,
          prevRatingHistory: Array.isArray(decodedUser.ratingHistory)
            ? (decodedUser.ratingHistory as RatingHistoryPoint[])
            : undefined,
          problemLookup: problemMetaLookup,
          submittedProblemId: problemId,
          submittedAtMs,
        });

        const nextStats = computeStatsFromProgress(nextProgressSummary);
        const prevActivity =
          decodedUser.activityByDate &&
          typeof decodedUser.activityByDate === 'object' &&
          !Array.isArray(decodedUser.activityByDate)
            ? (decodedUser.activityByDate as Record<string, number>)
            : undefined;
        const nextActivityByDate = incrementActivityOnDate(
          deriveActivityMapWithFallback(prevActivity, prevProgressRaw),
          submittedAtMs,
          1
        );

        const existingCreatedAtIso =
          existingUserDoc?.fields?.createdAt?.timestampValue ?? nowIso;

        const email =
          typeof decodedUser.email === 'string'
            ? decodedUser.email
            : user.email && user.email.includes('@')
              ? user.email.slice(0, 254)
              : null;
        const displayName =
          typeof decodedUser.displayName === 'string' &&
          decodedUser.displayName.length > 0
            ? decodedUser.displayName
            : user.name
              ? user.name.trim().slice(0, 120)
              : null;
        const photoURL =
          typeof decodedUser.photoURL === 'string' &&
          (decodedUser.photoURL.startsWith('https://') ||
            decodedUser.photoURL.startsWith('http://'))
            ? decodedUser.photoURL
            : user.picture &&
                (user.picture.startsWith('https://') ||
                  user.picture.startsWith('http://'))
              ? user.picture.slice(0, 2048)
              : null;

        const preferredTheme =
          decodedUser.preferredTheme === 'light' ||
          decodedUser.preferredTheme === 'dark'
            ? decodedUser.preferredTheme
            : undefined;
        const canvasHeight =
          typeof decodedUser.canvasHeight === 'number' &&
          decodedUser.canvasHeight >= 320 &&
          decodedUser.canvasHeight <= 1600
            ? Math.round(decodedUser.canvasHeight)
            : undefined;

        // Build the public leaderboard state from the account's own recorded progress.
        // The public row is created at the first solve, so it cannot be accumulated
        // from earlier rows: it must already contain the problems attempted before.
        const lbProblemScores: Record<string, { score: number; ac: boolean }> = {};
        for (const [pid, entry] of Object.entries(nextProgressSummary)) {
          if (!entry) continue;
          lbProblemScores[pid] = {
            score: Math.max(0, Math.round(entry.bestScore || 0)),
            ac: entry.status === 'ac',
          };
        }
        const lbIsAc = nextStatus === 'ac';
        const lbBestProblemScore = nextBestScore;

        let lbAcceptedCount = 0;
        let lbAttemptedCount = 0;
        let lbTotalBestScore = 0;
        for (const entry of Object.values(lbProblemScores)) {
          lbAttemptedCount += 1;
          if (entry.ac) lbAcceptedCount += 1;
          lbTotalBestScore += entry.score;
        }
        // An account is on the public leaderboard only once it has solved a problem
        const isRanked = lbAcceptedCount >= 1;

        const userFields = this.encoder.encodeFields({
          uid: user.uid,
          email,
          displayName,
          photoURL,
          ...(preferredTheme ? { preferredTheme } : {}),
          ...(canvasHeight !== undefined ? { canvasHeight } : {}),
          rating: ratingUpdate.rating,
          maxRating: ratingUpdate.maxRating,
          ratingHistory: ratingUpdate.ratingHistory,
          stats: nextStats,
          progressSummary: nextProgressSummary,
          activityByDate: nextActivityByDate,
          createdAt: this.encoder.timestamp(existingCreatedAtIso),
          updatedAt: this.encoder.timestamp(nowIso),
        });

        const probStateFields = this.encoder.encodeFields({
          uid: user.uid,
          problemId,
          draft: cleanSnap,
          bestScore: nextBestScore,
          bestVerdict: nextBestVerdict,
          runsCount: nextRunsCount,
          updatedAt: this.encoder.timestamp(nowIso),
        });

        const subFields = this.encoder.encodeFields({
          uid: user.uid,
          submissionId: safeSubId,
          submissionName: evaluation.submissionName.slice(0, 80) || 'Submission',
          problemId,
          submittedAtIso,
          submittedAtMs,
          verdict: evaluation.score.verdict,
          totalScore: evalTotalScore,
          pillars: evaluation.score.pillars,
          metricsSummary: {
            weightedP50Ms: evaluation.score.metrics.weightedP50Ms,
            weightedP99Ms: evaluation.score.metrics.weightedP99Ms,
            monthlyCostUsd: evaluation.score.metrics.monthlyCostUsd,
            overallAvailabilityPct: evaluation.score.metrics.overallAvailabilityPct,
          },
          snapshot: cleanSnap,
          createdAt: this.encoder.timestamp(nowIso),
        });

        const lbFields = this.encoder.encodeFields({
          uid: user.uid,
          handle,
          photoURL,
          rating: ratingUpdate.rating,
          rankTitle: ratingUpdate.rankTitle,
          acceptedCount: lbAcceptedCount,
          attemptedCount: lbAttemptedCount,
          totalBestScore: lbTotalBestScore,
          problemScoresJson: JSON.stringify(lbProblemScores),
          updatedAtIso: nowIso,
        });

        const probLbFields = this.encoder.encodeFields({
          uid: user.uid,
          handle,
          bestScore: lbBestProblemScore,
          verdict: lbIsAc ? 'AC' : nextBestVerdict,
          updatedAtIso: nowIso,
        });

        const writes: unknown[] = [
          {
            update: { name: userDocName, fields: userFields },
            currentDocument: existingUserDoc?.updateTime
              ? { updateTime: existingUserDoc.updateTime }
              : { exists: false },
          },
          {
            update: { name: probStateDocName, fields: probStateFields },
            currentDocument: existingProbDoc?.updateTime
              ? { updateTime: existingProbDoc.updateTime }
              : { exists: false },
          },
          {
            update: { name: subDocName, fields: subFields },
            currentDocument: { exists: false },
          },
        ];
        if (isRanked) {
          writes.push(
            {
              update: { name: lbDocName, fields: lbFields },
              currentDocument: existingLbDoc?.updateTime
                ? { updateTime: existingLbDoc.updateTime }
                : { exists: false },
            },
            {
              update: { name: probLbDocName, fields: probLbFields },
            }
          );
        }

        const commitRes = await this.fetcher(`${apiBase}:commit`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ writes }),
          cache: 'no-store',
        });

        if (commitRes.ok) {
          return { persistedUserState: true, leaderboardSynced: true };
        }

        if (!(await isRetryableWriteConflict(commitRes))) {
          console.error(
            `[AuthoritativeSubmissionRepository.persistEvaluation] commit failed (${commitRes.status}) ${await describeFirestoreError(commitRes)}`
          );
          return notRecorded(`write_http_${commitRes.status}`);
        }
      }

      console.error(
        `[AuthoritativeSubmissionRepository.persistEvaluation] still conflicting after ${MAX_OCC_RETRIES} attempts`
      );
      return notRecorded('write_conflict');
    } catch (err) {
      console.error('[AuthoritativeSubmissionRepository.persistEvaluation] error:', err);
      return notRecorded('server_exception');
    }
  }

  private decodeFieldsMap(
    fields?: Record<string, FirestoreRestValue>
  ): Record<string, unknown> {
    if (!fields) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = this.codec.decodeValue(v);
    }
    return out;
  }
}

export const defaultSubmissionRepository = new AuthoritativeSubmissionRepository();

export async function persistAuthoritativeSubmission(
  user: VerifiedFirebaseUser,
  evaluation: EvaluationResult
): Promise<ServerSubmissionPersistResult> {
  return defaultSubmissionRepository.persistEvaluation(user, evaluation);
}
