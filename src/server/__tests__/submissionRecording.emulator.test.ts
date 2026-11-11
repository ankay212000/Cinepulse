import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCEPTED_URL_SHORTENER_DESIGN,
  NOT_ACCEPTED_URL_SHORTENER_DESIGN,
} from '@/server/__tests__/fixtures/urlShortenerDesigns';
import { JudgeEngineService } from '@/server/engine/oop';
import { DiscreteEventSimulator } from '@/server/engine/simulator';
import { ProblemTestSuiteEvaluator } from '@/server/engine/testCases';
import { getProblemById } from '@/server/problems/catalog';
import { AuthoritativeSubmissionRepository } from '@/server/security/AuthoritativeSubmissionRepository';
import {
  AuthoritativeLeaderboardRepository,
  type ServiceAccountTokenProvider,
} from '@/server/security/firestoreRestAdmin';

/**
 * Runs the real server-side recording code (`/api/judge/evaluate` persistence)
 * against the Firestore emulator, so the exact REST payloads, field encodings and
 * optimistic-concurrency preconditions are checked by a real Firestore engine
 * rather than by a hand-written fake. Run with `npm run test:rules`.
 */

const PROJECT_ID = 'demo-judge-system';
const EMULATOR_ORIGIN = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}`;
const DOCS = `projects/${PROJECT_ID}/databases/(default)/documents`;
const ADMIN_HEADERS = {
  Authorization: 'Bearer owner',
  'Content-Type': 'application/json',
};

const emulatorTokenProvider = {
  resolveAuthContext: async () => ({
    projectId: PROJECT_ID,
    accessToken: 'owner',
  }),
} as unknown as ServiceAccountTokenProvider;

function toEmulator(url: string): string {
  return url.replace('https://firestore.googleapis.com', EMULATOR_ORIGIN);
}

type RestValue = Record<string, unknown>;

function decode(value: RestValue | undefined): unknown {
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    const arr = value.arrayValue as { values?: RestValue[] };
    return (arr.values ?? []).map((v) => decode(v));
  }
  if ('mapValue' in value) {
    const map = value.mapValue as { fields?: Record<string, RestValue> };
    return Object.fromEntries(
      Object.entries(map.fields ?? {}).map(([k, v]) => [k, decode(v)])
    );
  }
  return undefined;
}

async function readDoc(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${EMULATOR_ORIGIN}/v1/${DOCS}/${path}`, {
    headers: ADMIN_HEADERS,
  });
  if (res.status === 404) return null;
  const json = (await res.json()) as { fields?: Record<string, RestValue> };
  return decode({ mapValue: { fields: json.fields ?? {} } }) as Record<
    string,
    unknown
  >;
}

async function listIds(collectionPath: string): Promise<string[]> {
  const res = await fetch(
    `${EMULATOR_ORIGIN}/v1/${DOCS}/${collectionPath}?pageSize=50`,
    { headers: ADMIN_HEADERS }
  );
  const json = (await res.json()) as { documents?: Array<{ name: string }> };
  return (json.documents ?? []).map((d) => d.name.split('/').pop() ?? '');
}

async function adminWrite(
  path: string,
  fields: Record<string, RestValue>
): Promise<void> {
  const res = await fetch(`${EMULATOR_ORIGIN}/v1/${DOCS}/${path}`, {
    method: 'PATCH',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ fields }),
  });
  expect(res.ok).toBe(true);
}

const str = (v: string): RestValue => ({ stringValue: v });
const int = (v: number): RestValue => ({ integerValue: String(v) });
const map = (fields: Record<string, RestValue>): RestValue => ({
  mapValue: { fields },
});
const SAMPLE_DRAFT: RestValue = map({
  nodes: { arrayValue: { values: [] } },
  edges: { arrayValue: { values: [] } },
  boundaries: { arrayValue: { values: [] } },
  writeupMarkdown: str('Older draft.'),
});

function evaluateFor(uid: string, extraSentence = '') {
  const service = new JudgeEngineService({
    simulator: new DiscreteEventSimulator(),
    testSuiteEvaluator: new ProblemTestSuiteEvaluator(),
  });
  const problem = getProblemById('url-shortener');
  return service.evaluateSubmission(
    {
      problemId: problem.id,
      nodes: [
        { id: 'cl', label: 'Clients', x: 20, y: 80, width: 120, height: 50 },
        { id: 'api', label: 'API Service x6 medium', x: 220, y: 80, width: 150, height: 50 },
        { id: 'rc', label: 'Redis Cache x2', x: 420, y: 30, width: 150, height: 50 },
        { id: 'db', label: 'DynamoDB Store', x: 420, y: 140, width: 150, height: 50 },
      ],
      edges: [
        { id: 'e1', from: 'cl', to: 'api' },
        { id: 'e2', from: 'api', to: 'rc' },
        { id: 'e3', from: 'api', to: 'db' },
      ],
      boundaries: [],
      writeupMarkdown: `API Service x6 medium with singleflight and connection pooling; Redis 24 GB RAM TTL 120s; DynamoDB 2 shards salted short_code quorum 2 replicas.${extraSentence}`,
    },
    problem,
    { verifiedUid: uid }
  );
}

function evaluateDesign(
  uid: string,
  problemId: string,
  design: typeof ACCEPTED_URL_SHORTENER_DESIGN
) {
  const problem = getProblemById(problemId);
  return new JudgeEngineService({
    simulator: new DiscreteEventSimulator(),
    testSuiteEvaluator: new ProblemTestSuiteEvaluator(),
  }).evaluateSubmission({ problemId: problem.id, ...design }, problem, {
    verifiedUid: uid,
  });
}

// Unique ids per run, so these tests never depend on, or wipe, other emulator data
const RUN = Date.now().toString(36);

describe('Server recording of official results (Live Firestore Emulator)', () => {
  it('records a first Accepted result as five documents, including the public leaderboard row', async () => {
    const uid = `first_time_${RUN}`;
    const evaluation = evaluateDesign(uid, 'url-shortener', ACCEPTED_URL_SHORTENER_DESIGN);
    expect(evaluation.score.verdict).toBe('AC');
    const repo = new AuthoritativeSubmissionRepository({
      tokenProvider: emulatorTokenProvider,
      fetcher: (url, init) => fetch(toEmulator(url), init),
    });

    const outcome = await repo.persistEvaluation(
      { uid, email: 'first@example.com', name: 'First Timer', picture: null },
      evaluation
    );
    expect(outcome).toEqual({ persistedUserState: true, leaderboardSynced: true });

    const score = Math.round(evaluation.score.totalScore);
    const userDoc = await readDoc(`users/${uid}`);
    expect(userDoc?.stats).toMatchObject({ attemptedCount: 1, totalSubmissions: 1, totalBestScore: score });
    expect(typeof userDoc?.createdAt).toBe('string');
    const stateDoc = await readDoc(`users/${uid}/problemStates/url-shortener`);
    expect(stateDoc).toMatchObject({ bestScore: score, runsCount: 1 });
    expect(await listIds(`users/${uid}/problemStates/url-shortener/submissions`)).toEqual([
      evaluation.submissionId,
    ]);
    const row = await readDoc(`leaderboard/${uid}`);
    expect(row).toMatchObject({ uid, handle: 'First Timer', acceptedCount: 1, attemptedCount: 1, totalBestScore: score });
    expect(await readDoc(`problemLeaderboards/url-shortener/entries/${uid}`)).toMatchObject({ bestScore: score, verdict: 'AC' });
  });

  it('writes no leaderboard document for attempts without an Accepted verdict, then creates the row at the first solve with those attempts included', async () => {
    const uid = `attempts_then_solve_${RUN}`;
    const who = { uid, email: 'later@example.com', name: 'Solves Later', picture: null };
    const repo = new AuthoritativeSubmissionRepository({
      tokenProvider: emulatorTokenProvider,
      fetcher: (url, init) => fetch(toEmulator(url), init),
    });
    const recorded = { persistedUserState: true, leaderboardSynced: true };

    // 1. An attempt on another problem, not Accepted
    const otherAttempt = evaluateDesign(uid, 'distributed-rate-limiter', NOT_ACCEPTED_URL_SHORTENER_DESIGN);
    expect(otherAttempt.score.verdict).not.toBe('AC');
    expect(await repo.persistEvaluation(who, otherAttempt)).toEqual(recorded);
    // 2. An attempt on URL Shortener, scored but not Accepted
    const attempt = evaluateDesign(uid, 'url-shortener', NOT_ACCEPTED_URL_SHORTENER_DESIGN);
    expect(attempt.score.verdict).not.toBe('AC');
    expect(attempt.score.totalScore).toBeGreaterThan(0);
    expect(await repo.persistEvaluation(who, attempt)).toEqual(recorded);

    // Both attempts are recorded privately...
    const afterAttempts = await readDoc(`users/${uid}`);
    expect(afterAttempts?.stats).toMatchObject({ acceptedCount: 0, attemptedCount: 2, totalSubmissions: 2 });
    expect(await listIds(`users/${uid}/problemStates/url-shortener/submissions`)).toEqual([attempt.submissionId]);
    // ...and nothing public exists for this account
    expect(await readDoc(`leaderboard/${uid}`)).toBeNull();
    expect(await readDoc(`problemLeaderboards/url-shortener/entries/${uid}`)).toBeNull();
    expect(await readDoc(`problemLeaderboards/distributed-rate-limiter/entries/${uid}`)).toBeNull();

    // 3. The first Accepted result puts the account on the leaderboard, with everything
    //    it attempted before
    const solve = evaluateDesign(uid, 'url-shortener', ACCEPTED_URL_SHORTENER_DESIGN);
    expect(solve.score.verdict).toBe('AC');
    expect(await repo.persistEvaluation(who, solve)).toEqual(recorded);

    const otherScore = Math.round(otherAttempt.score.totalScore);
    const best = Math.max(Math.round(attempt.score.totalScore), Math.round(solve.score.totalScore));
    const row = await readDoc(`leaderboard/${uid}`);
    expect(row).toMatchObject({
      uid,
      handle: 'Solves Later',
      acceptedCount: 1,
      attemptedCount: 2,
      totalBestScore: otherScore + best,
    });
    expect(JSON.parse(String(row?.problemScoresJson))).toEqual({
      'distributed-rate-limiter': { score: otherScore, ac: false },
      'url-shortener': { score: best, ac: true },
    });
    expect(await readDoc(`problemLeaderboards/url-shortener/entries/${uid}`)).toMatchObject({ bestScore: best, verdict: 'AC' });
    // The public row and the private profile agree
    const afterSolve = await readDoc(`users/${uid}`);
    expect(afterSolve?.stats).toMatchObject({ acceptedCount: 1, attemptedCount: 2, totalSubmissions: 3, totalBestScore: otherScore + best });
  });

  it('gives an account that has progress but no leaderboard row (data from before server recording) its public row on the next Submit', async () => {
    const uid = `early_account_${RUN}`;
    await adminWrite(`users/${uid}`, {
      uid: str(uid),
      email: str('early@example.com'),
      displayName: str('Early Account'),
      photoURL: str('https://example.com/a.png'),
      preferredTheme: str('dark'),
      canvasHeight: int(878),
      stats: map({ acceptedCount: int(1), attemptedCount: int(1), totalSubmissions: int(16), totalBestScore: int(901) }),
      progressSummary: map({
        'url-shortener': map({ status: str('ac'), bestScore: int(901), bestVerdict: str('AC'), runsCount: int(16), lastSubmittedAtMs: int(1794117269000) }),
      }),
      activityByDate: map({ '2026-11-08': int(16) }),
      createdAt: { timestampValue: '2026-11-08T05:50:00Z' },
      updatedAt: { timestampValue: '2026-11-11T13:30:02Z' },
    });
    await adminWrite(`users/${uid}/problemStates/url-shortener`, {
      uid: str(uid),
      problemId: str('url-shortener'),
      draft: SAMPLE_DRAFT,
      bestScore: int(901),
      bestVerdict: str('AC'),
      runsCount: int(16),
      updatedAt: { timestampValue: '2026-11-10T11:00:17Z' },
    });
    expect(await readDoc(`leaderboard/${uid}`)).toBeNull();

    const evaluation = evaluateFor(uid);
    const outcome = await new AuthoritativeSubmissionRepository({
      tokenProvider: emulatorTokenProvider,
      fetcher: (url, init) => fetch(toEmulator(url), init),
    }).persistEvaluation(
      { uid, email: 'early@example.com', name: 'Early Account', picture: 'https://example.com/a.png' },
      evaluation
    );
    expect(outcome).toEqual({ persistedUserState: true, leaderboardSynced: true });

    const best = Math.max(901, Math.round(evaluation.score.totalScore));
    const row = await readDoc(`leaderboard/${uid}`);
    expect(row).toMatchObject({ uid, handle: 'Early Account', acceptedCount: 1, attemptedCount: 1, totalBestScore: best });
    const userDoc = await readDoc(`users/${uid}`);
    expect(userDoc?.stats).toMatchObject({ acceptedCount: 1, attemptedCount: 1, totalSubmissions: 17, totalBestScore: best });
    expect(userDoc).toMatchObject({ preferredTheme: 'dark', canvasHeight: 878, createdAt: '2026-11-08T05:50:00Z' });
    const stateDoc = await readDoc(`users/${uid}/problemStates/url-shortener`);
    expect(stateDoc).toMatchObject({ bestScore: best, bestVerdict: 'AC', runsCount: 17 });
  });

  it('still records the result when the browser autosaves the draft between the server reading and writing', async () => {
    const uid = `autosave_race_${RUN}`;
    await adminWrite(`users/${uid}`, {
      uid: str(uid),
      email: str('race@example.com'),
      displayName: str('Race Tester'),
      photoURL: { nullValue: null },
      stats: map({ acceptedCount: int(0), attemptedCount: int(0), totalSubmissions: int(0), totalBestScore: int(0) }),
      progressSummary: map({}),
      createdAt: { timestampValue: '2026-11-11T12:00:00Z' },
      updatedAt: { timestampValue: '2026-11-11T12:00:00Z' },
    });
    await adminWrite(`users/${uid}/problemStates/url-shortener`, {
      uid: str(uid),
      problemId: str('url-shortener'),
      draft: SAMPLE_DRAFT,
      bestScore: int(0),
      bestVerdict: { nullValue: null },
      runsCount: int(0),
      updatedAt: { timestampValue: '2026-11-11T12:00:00Z' },
    });

    const commitStatuses: number[] = [];
    let autosaved = false;
    const racingFetcher = async (url: string, init: RequestInit) => {
      if (url.endsWith(':commit') && !autosaved) {
        // The browser's draft autosave lands right before the server's first write
        autosaved = true;
        const bump = await fetch(
          `${EMULATOR_ORIGIN}/v1/${DOCS}/users/${uid}/problemStates/url-shortener?updateMask.fieldPaths=updatedAt`,
          {
            method: 'PATCH',
            headers: ADMIN_HEADERS,
            body: JSON.stringify({ fields: { updatedAt: { timestampValue: new Date().toISOString() } } }),
          }
        );
        expect(bump.ok).toBe(true);
      }
      const res = await fetch(toEmulator(url), init);
      if (url.endsWith(':commit')) commitStatuses.push(res.status);
      return res;
    };

    const evaluation = evaluateDesign(uid, 'url-shortener', ACCEPTED_URL_SHORTENER_DESIGN);
    expect(evaluation.score.verdict).toBe('AC');
    const outcome = await new AuthoritativeSubmissionRepository({
      tokenProvider: emulatorTokenProvider,
      fetcher: racingFetcher,
    }).persistEvaluation(
      { uid, email: 'race@example.com', name: 'Race Tester', picture: null },
      evaluation
    );

    // First write is refused with 400 FAILED_PRECONDITION (stale version); the retry succeeds
    expect(commitStatuses).toEqual([400, 200]);
    expect(outcome).toEqual({ persistedUserState: true, leaderboardSynced: true });
    expect(await readDoc(`leaderboard/${uid}`)).toMatchObject({ uid, attemptedCount: 1 });
    expect(await listIds(`users/${uid}/problemStates/url-shortener/submissions`)).toHaveLength(1);
  });
});

describe('Who the public leaderboard shows (Live Firestore Emulator)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const publicRow = (uid: string, solved: number, attempted: number, points: number) => ({
    uid: str(uid),
    handle: str(`Name ${uid}`),
    photoURL: { nullValue: null } as RestValue,
    rating: int(1228),
    rankTitle: str('Associate Architect'),
    acceptedCount: int(solved),
    attemptedCount: int(attempted),
    totalBestScore: int(points),
    problemScoresJson: str('{}'),
    updatedAtIso: str('2026-11-11T12:00:00.000Z'),
  });

  it('lists only architects who have solved at least one problem, on the standings and for share cards', async () => {
    const solver = `lb_solver_${RUN}`;
    const attemptedOnly = `lb_attempted_${RUN}`;
    await adminWrite(`leaderboard/${solver}`, publicRow(solver, 1, 1, 901));
    // More points than the solver, but nothing solved
    await adminWrite(`leaderboard/${attemptedOnly}`, publicRow(attemptedOnly, 0, 1, 950));

    // The site's own read path, pointed at the emulator instead of production
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', PROJECT_ID);
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) =>
      realFetch(toEmulator(String(input)), init)
    );
    const reader = new AuthoritativeLeaderboardRepository(emulatorTokenProvider);

    const listed = (await reader.fetchGlobalStandings(100)).map((e) => e.uid);
    expect(listed).toContain(solver);
    expect(listed).not.toContain(attemptedOnly);

    expect(await reader.fetchPublicEntryByUid(solver)).toMatchObject({ uid: solver, acceptedCount: 1 });
    expect(await reader.fetchPublicEntryByUid(attemptedOnly)).toBeNull();
  });
});
