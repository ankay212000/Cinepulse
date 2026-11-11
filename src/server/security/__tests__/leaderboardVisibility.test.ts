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
 * Who is on the public leaderboard: only architects who have solved at least one
 * problem. An account with attempts but no Accepted verdict is recorded privately;
 * it gets no leaderboard document, is not ranked and has no public card.
 */

const PROJECT = 'judge-system-9837a';
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;

const anyCredentials = {
  resolveAuthContext: async () => ({ projectId: PROJECT, accessToken: 'ya29.server' }),
} as unknown as ServiceAccountTokenProvider;

function publicRow(uid: string, solved: number, attempted: number, points: number) {
  return {
    name: `${DOCS}/leaderboard/${uid}`,
    fields: {
      uid: { stringValue: uid },
      handle: { stringValue: `Handle ${uid}` },
      photoURL: { nullValue: null },
      rating: { integerValue: '1250' },
      rankTitle: { stringValue: 'Associate Architect' },
      acceptedCount: { integerValue: String(solved) },
      attemptedCount: { integerValue: String(attempted) },
      totalBestScore: { integerValue: String(points) },
      problemScoresJson: { stringValue: '{}' },
      updatedAtIso: { stringValue: '2026-11-11T16:00:00.000Z' },
    },
  };
}

interface SeenRequest {
  url: string;
  authorization: string | null;
  body: Record<string, unknown> | null;
}

/** Fakes Firestore REST for the public read path and records every request. */
function stubFirestore(handlers: {
  runQuery?: () => Response;
  getDoc?: () => Response;
}): SeenRequest[] {
  const seen: SeenRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({
        url,
        authorization: headers.get('Authorization'),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      if (url.includes(':runQuery') && handlers.runQuery) return handlers.runQuery();
      if (url.includes('/documents/leaderboard/') && handlers.getDoc) return handlers.getDoc();
      throw new Error(`unexpected request in test: ${url}`);
    })
  );
  return seen;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const ROWS = [
  { document: publicRow('solved_one', 1, 1, 901) },
  { document: publicRow('solved_two', 2, 3, 1500) },
  { document: publicRow('solved_one_low', 1, 2, 800) },
  // Never returned by the real query (it filters solved > 0); guards the code path too.
  // More points than a solver, and still not ranked.
  { document: publicRow('attempted_only', 0, 1, 950) },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Public leaderboard visibility', () => {
  it('lists only architects who have solved at least one problem, ordered by points', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', PROJECT);
    const seen = stubFirestore({ runQuery: () => json(ROWS) });

    const repo = new AuthoritativeLeaderboardRepository(anyCredentials);
    const entries = await repo.fetchGlobalStandings(50);
    expect(entries.map((e) => e.uid)).toEqual(['solved_two', 'solved_one', 'solved_one_low']);

    // One public, unauthenticated query that itself asks only for solvers
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain(`/projects/${PROJECT}/databases/(default)/documents:runQuery`);
    expect(seen[0].authorization).toBeNull();
    expect(JSON.stringify(seen[0].body)).toContain(
      '"where":{"fieldFilter":{"field":{"fieldPath":"acceptedCount"},"op":"GREATER_THAN","value":{"integerValue":"0"}}}'
    );

    // The limit applies after the filter
    stubFirestore({ runQuery: () => json(ROWS) });
    expect((await repo.fetchGlobalStandings(2)).map((e) => e.uid)).toEqual([
      'solved_two',
      'solved_one',
    ]);

    // A failed query gives an empty board, not an error page
    stubFirestore({ runQuery: () => json({ error: { status: 'UNAVAILABLE' } }, 503) });
    expect(await repo.fetchGlobalStandings(50)).toEqual([]);
  });

  it('gives a public share card only to architects who have solved a problem', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', PROJECT);
    const repo = new AuthoritativeLeaderboardRepository(anyCredentials);

    stubFirestore({ getDoc: () => json(publicRow('attempted_only', 0, 1, 306)) });
    expect(await repo.fetchPublicEntryByUid('attempted_only')).toBeNull();

    stubFirestore({ getDoc: () => json(publicRow('solved_two', 2, 3, 1500)) });
    expect(await repo.fetchPublicEntryByUid('solved_two')).toMatchObject({
      uid: 'solved_two',
      acceptedCount: 2,
      totalBestScore: 1500,
    });

    // No public row at all
    stubFirestore({ getDoc: () => json({ error: { status: 'NOT_FOUND' } }, 404) });
    expect(await repo.fetchPublicEntryByUid('nobody')).toBeNull();
  });
});

describe('Public leaderboard documents written on Submit', () => {
  const UID = 'writer_1';
  const who = { uid: UID, email: 'writer@example.com', name: 'Writer One', picture: null };
  const USER_DOC = `${DOCS}/users/${UID}`;
  const STATE_DOC = `${DOCS}/users/${UID}/problemStates/url-shortener`;
  const ROW_DOC = `${DOCS}/leaderboard/${UID}`;
  const ENTRY_DOC = `${DOCS}/problemLeaderboards/url-shortener/entries/${UID}`;

  type Write = {
    update?: { name: string; fields: Record<string, { stringValue?: string; integerValue?: string }> };
    delete?: string;
    currentDocument?: unknown;
  };

  function judge(design: typeof ACCEPTED_URL_SHORTENER_DESIGN) {
    const problem = getProblemById('url-shortener');
    return new JudgeEngineService({
      simulator: new DiscreteEventSimulator(),
      testSuiteEvaluator: new ProblemTestSuiteEvaluator(),
    }).evaluateSubmission({ problemId: problem.id, ...design }, problem, { verifiedUid: UID });
  }

  /** Runs the recording code against a fake Firestore and returns the one commit it sends. */
  async function record(
    evaluation: ReturnType<typeof judge>,
    stored: unknown[]
  ): Promise<Write[]> {
    const commits: Array<{ writes: Write[] }> = [];
    const outcome = await new AuthoritativeSubmissionRepository({
      tokenProvider: anyCredentials,
      fetcher: async (url: string, init: RequestInit) => {
        if (url.endsWith(':batchGet')) return json(stored);
        commits.push(JSON.parse(String(init.body)) as { writes: Write[] });
        return json({ writeResults: [] });
      },
    }).persistEvaluation(who, evaluation);
    expect(outcome).toEqual({ persistedUserState: true, leaderboardSynced: true });
    expect(commits).toHaveLength(1);
    return commits[0].writes;
  }

  const targets = (writes: Write[]) => writes.map((w) => w.update?.name ?? `DELETE ${w.delete}`);
  const NOTHING_STORED = [{ missing: USER_DOC }, { missing: STATE_DOC }, { missing: ROW_DOC }];

  it('records an attempt that is not Accepted without any leaderboard document', async () => {
    const attempt = judge(NOT_ACCEPTED_URL_SHORTENER_DESIGN);
    expect(attempt.score.verdict).not.toBe('AC');
    expect(attempt.score.totalScore).toBeGreaterThan(0);

    // A brand-new account: profile, problem state and the run are written. Nothing public.
    const writes = await record(attempt, NOTHING_STORED);
    expect(targets(writes)).toEqual([
      USER_DOC,
      STATE_DOC,
      `${STATE_DOC}/submissions/${attempt.submissionId}`,
    ]);
    expect(JSON.stringify(writes)).not.toContain('/leaderboard/');
    expect(JSON.stringify(writes)).not.toContain('/problemLeaderboards/');
    // The attempt itself is still counted on the private profile
    const stats = (writes[0].update?.fields.stats as unknown as {
      mapValue: { fields: Record<string, { integerValue: string }> };
    }).mapValue.fields;
    expect(stats.attemptedCount.integerValue).toBe('1');
    expect(stats.acceptedCount.integerValue).toBe('0');
  });

  it('creates the leaderboard row at the first solve, including the problems attempted before it', async () => {
    const solve = judge(ACCEPTED_URL_SHORTENER_DESIGN);
    expect(solve.score.verdict).toBe('AC');
    const score = Math.round(solve.score.totalScore);

    // Two earlier attempts on another problem, never Accepted: no public row exists yet
    const writes = await record(solve, [
      {
        found: {
          name: USER_DOC,
          updateTime: '2026-11-11T16:00:00.000000Z',
          fields: {
            uid: { stringValue: UID },
            progressSummary: {
              mapValue: {
                fields: {
                  'distributed-rate-limiter': {
                    mapValue: {
                      fields: {
                        status: { stringValue: 'tried' },
                        bestScore: { integerValue: '300' },
                        bestVerdict: { stringValue: 'WA_FUNCTIONAL' },
                        runsCount: { integerValue: '2' },
                        lastSubmittedAtMs: { integerValue: '1794412800000' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { missing: STATE_DOC },
      { missing: ROW_DOC },
    ]);

    expect(targets(writes)).toEqual([
      USER_DOC,
      STATE_DOC,
      `${STATE_DOC}/submissions/${solve.submissionId}`,
      ROW_DOC,
      ENTRY_DOC,
    ]);
    const row = writes[3];
    expect(row.currentDocument).toEqual({ exists: false });
    expect(row.update?.fields.acceptedCount.integerValue).toBe('1');
    expect(row.update?.fields.attemptedCount.integerValue).toBe('2');
    expect(row.update?.fields.totalBestScore.integerValue).toBe(String(300 + score));
    expect(JSON.parse(row.update?.fields.problemScoresJson.stringValue ?? '{}')).toEqual({
      'distributed-rate-limiter': { score: 300, ac: false },
      'url-shortener': { score, ac: true },
    });
    expect(row.update?.fields.handle.stringValue).toBe('Writer One');
    expect(writes[4].update?.fields.verdict.stringValue).toBe('AC');
  });

  it('keeps a solver on the leaderboard when a later attempt is not Accepted', async () => {
    const attempt = judge(NOT_ACCEPTED_URL_SHORTENER_DESIGN);
    expect(attempt.score.verdict).not.toBe('AC');

    const writes = await record(attempt, [
      {
        found: {
          name: USER_DOC,
          updateTime: '2026-11-11T16:00:00.000000Z',
          fields: {
            uid: { stringValue: UID },
            progressSummary: {
              mapValue: {
                fields: {
                  'url-shortener': {
                    mapValue: {
                      fields: {
                        status: { stringValue: 'ac' },
                        bestScore: { integerValue: '901' },
                        bestVerdict: { stringValue: 'AC' },
                        runsCount: { integerValue: '16' },
                        lastSubmittedAtMs: { integerValue: '1794117269000' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { missing: STATE_DOC },
      { found: { ...publicRow(UID, 1, 1, 901), updateTime: '2026-11-11T15:37:10.024592Z' } },
    ]);

    expect(targets(writes)).toEqual([
      USER_DOC,
      STATE_DOC,
      `${STATE_DOC}/submissions/${attempt.submissionId}`,
      ROW_DOC,
      ENTRY_DOC,
    ]);
    expect(writes[3].currentDocument).toEqual({ updateTime: '2026-11-11T15:37:10.024592Z' });
    expect(writes[3].update?.fields.acceptedCount.integerValue).toBe('1');
    expect(writes[3].update?.fields.totalBestScore.integerValue).toBe('901');
    expect(writes[4].update?.fields.verdict.stringValue).toBe('AC');
  });
});
