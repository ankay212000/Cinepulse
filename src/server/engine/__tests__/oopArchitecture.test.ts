import { describe, expect, it, vi } from 'vitest';
import { POST as postEvaluate } from '@/app/api/judge/evaluate/route';
import { POST as postReplay } from '@/app/api/judge/replay/route';
import { POST as postRun } from '@/app/api/judge/run/route';
import {
  AlignmentAnalyzer,
  ArchetypeClassifier,
  CloudCostCalculator,
  CompetitiveRubricScorer,
  DesignCompiler,
  HmacReceiptSigner,
  type INodePricingStrategy,
  JudgeEngineService,
  VerdictGateJudge,
} from '@/server/engine/oop';
import { ACCEPTED_URL_SHORTENER_DESIGN } from '@/server/__tests__/fixtures/urlShortenerDesigns';
import { DiscreteEventSimulator } from '@/server/engine/simulator';
import { CacheHitRateEvaluator } from '@/server/engine/sim/CacheHitRateEvaluator';
import { TopologyGraphAnalyzer } from '@/server/engine/sim/TopologyGraphAnalyzer';
import { ProblemTestSuiteEvaluator } from '@/server/engine/testCases';
import {
  getProblemById,
  ProblemCatalog,
  PROBLEMS,
  toPublicProblemSpec,
} from '@/server/problems/catalog';
import {
  BASE_MONTHLY_USD,
  STANDARDIZED_COST_RATE_TABLE,
  STANDARDIZED_COST_RULES,
} from '@/lib/costingGuide';
import { getRubricCapsForDifficulty } from '@/lib/scoringScale';
import {
  buildProblemWriteupTemplate,
  buildWriteupPlaceholderHint,
  getWriteupRuleDimensions,
} from '@/lib/writeupRulesGuide';
import {
  FirestoreRestCodec,
  LruTtlCache,
} from '@/server/problems/dbCatalog';
import {
  AuthoritativeSubmissionRepository,
  FirestoreRestValueEncoder,
} from '@/server/security/AuthoritativeSubmissionRepository';
import type { ServiceAccountTokenProvider } from '@/server/security/firestoreRestAdmin';
import {
  BoundedInMemoryRateLimitStore,
  ClientIdentityResolver,
  SlidingWindowRateLimiter,
  UpstashRedisRateLimitStore,
} from '@/server/security/rateLimit';
import type { CostLineItem, SimNodeSpec } from '@/types';

describe('SOLID Object-Oriented Architecture & Security Hardening', () => {
  it('supports Open/Closed extensibility on CloudCostCalculator via injected INodePricingStrategy', () => {
    class CustomZeroCostCacheStrategy implements INodePricingStrategy {
      public supports(node: SimNodeSpec): boolean {
        return node.archetype === 'in_memory_cache';
      }
      public calculateMonthlyCost(node: SimNodeSpec): CostLineItem {
        return {
          canvasNodeId: node.canvasNodeId,
          userLabel: node.userLabel,
          monthlyUsd: 42,
          detail: 'Custom promotional Redis tier',
        };
      }
    }

    const customCalc = new CloudCostCalculator([
      new CustomZeroCostCacheStrategy(),
      ...CloudCostCalculator.defaultStrategies(),
    ]);

    const compiler = DesignCompiler.createDefault();
    const ir = compiler.compile({
      problemId: 'url-shortener',
      nodes: [
        { id: 'c1', label: 'Redis Cache 64GB', x: 0, y: 0, width: 120, height: 60 },
      ],
      edges: [],
      boundaries: [],
      writeupMarkdown: '64 GB Redis cache cluster.',
    });

    const lineItem = customCalc.calculateNodeCost(ir.nodes[0]);
    expect(lineItem.monthlyUsd).toBe(42);
    expect(lineItem.detail).toBe('Custom promotional Redis tier');
  });

  it('signs and verifies receipts in constant time via HmacReceiptSigner and rejects tampering', () => {
    const signer = new HmacReceiptSigner(() => 'super-secret-contest-key-2026');
    const payload = {
      submissionId: 'sub_abc123',
      problemId: 'url-shortener',
      submittedAtIso: '2026-11-08T15:00:00.000Z',
      verifiedUid: 'user_99',
      verdict: 'AC',
      totalScore: 925,
    };

    const sig = signer.sign(payload);
    expect(sig).toBeTruthy();
    expect(signer.verify(payload, sig!)).toBe(true);

    // Tampered score, verdict, or UID must fail verification
    expect(signer.verify({ ...payload, totalScore: 1000 }, sig!)).toBe(false);
    expect(signer.verify({ ...payload, verifiedUid: 'attacker_1' }, sig!)).toBe(
      false
    );
    expect(signer.verify(payload, 'deadbeef')).toBe(false);
  });

  it('orchestrates JudgeEngineService cleanly via constructor Dependency Injection', () => {
    const service = new JudgeEngineService({
      compiler: new DesignCompiler({
        classifier: new ArchetypeClassifier(),
        alignmentAnalyzer: new AlignmentAnalyzer(),
      }),
      simulator: new DiscreteEventSimulator(),
      scorer: new CompetitiveRubricScorer({
        verdictGateJudge: new VerdictGateJudge(),
      }),
      testSuiteEvaluator: new ProblemTestSuiteEvaluator(),
      receiptSigner: new HmacReceiptSigner(() => 'unit-test-hmac'),
    });

    const problem = getProblemById('url-shortener');
    const result = service.evaluateSubmission(
      {
        problemId: problem.id,
        nodes: [
          { id: 'cl', label: 'Clients', x: 20, y: 80, width: 120, height: 50 },
          { id: 'lb', label: 'ALB x2 medium', x: 180, y: 80, width: 140, height: 50 },
          { id: 'api', label: 'Redirect Service x6 medium', x: 360, y: 80, width: 160, height: 50 },
          { id: 'rc', label: 'Redis Cache x2', x: 560, y: 30, width: 150, height: 50 },
          { id: 'db', label: 'DynamoDB KV Store', x: 560, y: 140, width: 160, height: 50 },
        ],
        edges: [
          { id: 'e1', from: 'cl', to: 'lb' },
          { id: 'e2', from: 'lb', to: 'api' },
          { id: 'e3', from: 'api', to: 'rc' },
          { id: 'e4', from: 'api', to: 'db' },
        ],
        boundaries: [],
        writeupMarkdown: `
- ALB: 2 medium instances across multi-AZ for GET /{short_code} and POST /shorten.
- Redirect Service: 6 medium stateless instances with connection pooling and singleflight request coalescing.
- Redis Cache: 24 GB RAM, 1 replica, cache-aside with TTL 120s and singleflight stampede protection.
- DynamoDB KV Store: 2 shards partitioned by salted short_code (salted hash), quorum replication (2 replicas) across multi-AZ.
        `,
      },
      problem,
      { verifiedUid: 'uid_solid_test' }
    );

    expect(result.score.verdict).toBe('AC');
    expect(result.integrity?.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('bounds memory strictly via BoundedInMemoryRateLimitStore LRU eviction and enforces sliding window', () => {
    let fakeNow = 1_000_000;
    const store = new BoundedInMemoryRateLimitStore({
      maxBuckets: 64,
      sweepIntervalMs: 10_000,
    });
    const limiter = new SlidingWindowRateLimiter({
      store,
      clock: () => fakeNow,
    });

    // Insert 120 distinct caller keys — store must never exceed maxBuckets (64)
    for (let i = 0; i < 120; i += 1) {
      const res = limiter.checkLimit(`ip:10.0.0.${i}`, 2, 60_000);
      expect(res.allowed).toBe(true);
    }
    expect(store.size).toBeLessThanOrEqual(64);

    // Verify per-key quota enforcement and window recovery
    expect(limiter.checkLimit('uid:contestant_1', 2, 60_000).allowed).toBe(true);
    expect(limiter.checkLimit('uid:contestant_1', 2, 60_000).allowed).toBe(true);
    const blocked = limiter.checkLimit('uid:contestant_1', 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);

    fakeNow += 60_001;
    expect(limiter.checkLimit('uid:contestant_1', 2, 60_000).allowed).toBe(true);
  });

  it('resists leftmost X-Forwarded-For spoofing in ClientIdentityResolver', () => {
    const resolver = new ClientIdentityResolver();

    // Authenticated UID always wins
    const authedReq = new Request('http://localhost/api/judge/run', {
      headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.7' },
    });
    expect(resolver.resolve(authedReq, 'u_123')).toBe('uid:u_123');

    // Trusted Vercel edge header wins over spoofed X-Forwarded-For
    const vercelReq = new Request('http://localhost/api/judge/run', {
      headers: {
        'x-vercel-forwarded-for': '203.0.113.9',
        'x-forwarded-for': '9.9.9.9, 203.0.113.9',
      },
    });
    expect(resolver.resolve(vercelReq, null)).toBe('ip:203.0.113.9');

    // When only X-Forwarded-For is present, selects rightmost proxy-appended IP, not spoofed leftmost
    const spoofedXffReq = new Request('http://localhost/api/judge/run', {
      headers: {
        'x-forwarded-for': '6.6.6.6, 198.51.100.42',
      },
    });
    expect(resolver.resolve(spoofedXffReq, null)).toBe('ip:198.51.100.42');
  });

  it('enforces 401 auth gate, 400 malformed JSON, and 413 UTF-8 byte cap uniformly across /api/judge/* via ApiJudgeController', async () => {
    const prevAuthFlag = process.env.REQUIRE_AUTH_FOR_JUDGE;
    try {
      process.env.REQUIRE_AUTH_FOR_JUDGE = 'true';

      for (const handler of [postEvaluate, postReplay]) {
        const unauthRes = await handler(
          new Request('http://localhost/api/judge/test', {
            method: 'POST',
            body: JSON.stringify({ problemId: 'url-shortener' }),
          })
        );
        expect(unauthRes.status).toBe(401);
      }

      // Guest sandbox Sample Run (/api/judge/run) succeeds without login even when REQUIRE_AUTH_FOR_JUDGE='true'
      const guestRunRes = await postRun(
        new Request('http://localhost/api/judge/run', {
          method: 'POST',
          body: JSON.stringify({ problemId: 'url-shortener' }),
        })
      );
      expect(guestRunRes.status).toBe(200);
    } finally {
      if (prevAuthFlag === undefined) delete process.env.REQUIRE_AUTH_FOR_JUDGE;
      else process.env.REQUIRE_AUTH_FOR_JUDGE = prevAuthFlag;
    }

    // 400 on malformed JSON
    const badJsonRes = await postRun(
      new Request('http://localhost/api/judge/run', {
        method: 'POST',
        body: '{not-valid-json',
      })
    );
    expect(badJsonRes.status).toBe(400);

    // 413 on >256 KB multibyte UTF-8 body (e.g., 100,000 3-byte characters = 300 KB > 262,144 B even though .length < 262,144!)
    const multiBytePayload = JSON.stringify({
      problemId: 'url-shortener',
      writeup: '€'.repeat(100_000),
    });
    expect(multiBytePayload.length).toBeLessThan(262_144);
    expect(Buffer.byteLength(multiBytePayload, 'utf8')).toBeGreaterThan(262_144);

    const oversizeRes = await postEvaluate(
      new Request('http://localhost/api/judge/evaluate', {
        method: 'POST',
        body: multiBytePayload,
      })
    );
    expect(oversizeRes.status).toBe(413);
  });

  it('evicts least-recently-used entries and expires stale entries in LruTtlCache & FirestoreRestCodec', () => {
    const cache = new LruTtlCache<string, number>(16);
    for (let i = 0; i < 24; i += 1) {
      cache.set(`k_${i}`, i, 5_000, 1_000);
    }
    expect(cache.get('k_0', 1_500)).toBeUndefined();
    expect(cache.get('k_23', 1_500)).toBe(23);
    expect(cache.get('k_23', 7_000)).toBeUndefined();

    const codec = new FirestoreRestCodec();
    expect(codec.decodeValue({ integerValue: '42' })).toBe(42);
  });

  it('executes distributed Lua sliding-window rate limits via UpstashRedisRateLimitStore with fail-safe fallback', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    let simulateOutage = false;
    let redisCount = 0;

    const mockFetch: typeof fetch = async (input, init) => {
      if (simulateOutage) {
        throw new Error('Upstash network timeout');
      }
      const url = String(input);
      const parsedBody = JSON.parse(String(init?.body ?? '[]')) as unknown[];
      calls.push({ url, body: parsedBody });
      const nowMs = Number(parsedBody[3]);
      const limit = Number(parsedBody[5]);
      if (redisCount >= limit) {
        return new Response(JSON.stringify({ result: [0, 0, nowMs - 15_000] }), {
          status: 200,
        });
      }
      redisCount += 1;
      return new Response(
        JSON.stringify({ result: [1, limit - redisCount, 0] }),
        { status: 200 }
      );
    };

    const redisStore = new UpstashRedisRateLimitStore({
      restUrl: 'https://fake-upstash.upstash.io/',
      restToken: 'upstash-token-xyz',
      fetchImpl: mockFetch,
    });
    expect(redisStore.isDistributedConfigured()).toBe(true);

    const limiter = new SlidingWindowRateLimiter({
      store: redisStore,
      clock: () => 50_000,
    });

    const r1 = await limiter.checkLimitAsync('eval:uid:u1', 2, 60_000);
    const r2 = await limiter.checkLimitAsync('eval:uid:u1', 2, 60_000);
    const r3 = await limiter.checkLimitAsync('eval:uid:u1', 2, 60_000);

    expect(r1).toEqual({ allowed: true, remaining: 1, retryAfterSec: 0 });
    expect(r2).toEqual({ allowed: true, remaining: 0, retryAfterSec: 0 });
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSec).toBe(45);
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe('https://fake-upstash.upstash.io/eval');

    // Simulate Redis outage: must fail-safe into BoundedInMemoryRateLimitStore without throwing
    simulateOutage = true;
    const fallback1 = await limiter.checkLimitAsync('eval:uid:u2', 1, 60_000);
    const fallback2 = await limiter.checkLimitAsync('eval:uid:u2', 1, 60_000);
    expect(fallback1.allowed).toBe(true);
    expect(fallback2.allowed).toBe(false);
  });

  it('persists all 5 competitive state docs atomically with OCC retry in AuthoritativeSubmissionRepository', async () => {
    const fakeTokenProvider = {
      resolveAuthContext: async () => ({
        projectId: 'judge-system-9837a',
        accessToken: 'ya29.fake-server-token',
      }),
    } as unknown as ServiceAccountTokenProvider;

    const commitPayloads: Array<{ writes: Array<Record<string, unknown>> }> = [];
    let commitAttempts = 0;

    const fakeFetcher = async (url: string, init: RequestInit) => {
      if (url.endsWith(':batchGet')) {
        return new Response(
          JSON.stringify([
            {
              found: {
                name: 'projects/judge-system-9837a/databases/(default)/documents/users/user_occ_1',
                updateTime: '2026-11-08T16:00:00.000000Z',
                fields: {
                  uid: { stringValue: 'user_occ_1' },
                  preferredTheme: { stringValue: 'dark' },
                },
              },
            },
            {
              missing:
                'projects/judge-system-9837a/databases/(default)/documents/users/user_occ_1/problemStates/url-shortener',
            },
            {
              missing:
                'projects/judge-system-9837a/databases/(default)/documents/leaderboard/user_occ_1',
            },
          ]),
          { status: 200 }
        );
      }

      if (url.endsWith(':commit')) {
        commitAttempts += 1;
        commitPayloads.push(JSON.parse(String(init.body)));
        if (commitAttempts === 1) {
          // Simulate concurrent write 409 Conflict on attempt #1 -> repository must retry!
          return new Response(JSON.stringify({ error: 'ABORTED' }), {
            status: 409,
          });
        }
        return new Response(JSON.stringify({ writeResults: [] }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const repo = new AuthoritativeSubmissionRepository({
      tokenProvider: fakeTokenProvider,
      encoder: new FirestoreRestValueEncoder(),
      fetcher: fakeFetcher,
    });

    const service = new JudgeEngineService({
      simulator: new DiscreteEventSimulator(),
      testSuiteEvaluator: new ProblemTestSuiteEvaluator(),
    });
    const problem = getProblemById('url-shortener');
    // An Accepted design: the two public leaderboard documents are written only
    // once the account has solved a problem
    const evaluation = service.evaluateSubmission(
      { problemId: problem.id, ...ACCEPTED_URL_SHORTENER_DESIGN },
      problem,
      { verifiedUid: 'user_occ_1' }
    );
    expect(evaluation.score.verdict).toBe('AC');

    const outcome = await repo.persistEvaluation(
      {
        uid: 'user_occ_1',
        email: 'architect@example.com',
        name: 'Principal Architect',
        picture: 'https://example.com/avatar.png',
      },
      evaluation
    );

    expect(outcome).toEqual({
      persistedUserState: true,
      leaderboardSynced: true,
    });
    expect(commitAttempts).toBe(2);
    expect(commitPayloads[1].writes).toHaveLength(5);
    expect(commitPayloads[1].writes[0].currentDocument).toEqual({
      updateTime: '2026-11-08T16:00:00.000000Z',
    });
    expect(commitPayloads[1].writes[1].currentDocument).toEqual({
      exists: false,
    });
    expect(commitPayloads[1].writes[2].currentDocument).toEqual({
      exists: false,
    });
  });

  it('retries a stale-document conflict (HTTP 400 FAILED_PRECONDITION), reports why a result was not recorded, and never throws on bad credentials', async () => {
    const service = new JudgeEngineService({
      simulator: new DiscreteEventSimulator(),
      testSuiteEvaluator: new ProblemTestSuiteEvaluator(),
    });
    const problem = getProblemById('url-shortener');
    const evaluation = service.evaluateSubmission(
      {
        problemId: problem.id,
        nodes: [
          { id: 'cl', label: 'Clients', x: 20, y: 80, width: 120, height: 50 },
          { id: 'api', label: 'API Service x6 medium', x: 220, y: 80, width: 150, height: 50 },
          { id: 'db', label: 'DynamoDB Store', x: 420, y: 140, width: 150, height: 50 },
        ],
        edges: [
          { id: 'e1', from: 'cl', to: 'api' },
          { id: 'e2', from: 'api', to: 'db' },
        ],
        boundaries: [],
        writeupMarkdown:
          'API Service x6 medium reads and writes DynamoDB with 2 shards on salted short_code and quorum replication.',
      },
      problem,
      { verifiedUid: 'user_conflict_1' }
    );
    const verifiedUser = {
      uid: 'user_conflict_1',
      email: 'architect@example.com',
      name: 'Principal Architect',
      picture: null,
    };
    const okTokenProvider = {
      resolveAuthContext: async () => ({
        projectId: 'judge-system-9837a',
        accessToken: 'ya29.fake-server-token',
      }),
    } as unknown as ServiceAccountTokenProvider;

    const prefix =
      'projects/judge-system-9837a/databases/(default)/documents';
    const batchGetBody = (updateTime: string) =>
      JSON.stringify([
        {
          found: {
            name: `${prefix}/users/user_conflict_1`,
            updateTime,
            fields: { uid: { stringValue: 'user_conflict_1' } },
          },
        },
        {
          found: {
            name: `${prefix}/users/user_conflict_1/problemStates/url-shortener`,
            updateTime,
            fields: { runsCount: { integerValue: '1' } },
          },
        },
        { missing: `${prefix}/leaderboard/user_conflict_1` },
      ]);

    // 1. The browser's draft autosave lands between the server's read and its write:
    //    Firestore answers 400 FAILED_PRECONDITION. The repository must read again and retry.
    let reads = 0;
    let commits = 0;
    const secondAttemptPreconditions: unknown[] = [];
    const conflictThenOk = async (url: string, init: RequestInit) => {
      if (url.endsWith(':batchGet')) {
        reads += 1;
        return new Response(
          batchGetBody(
            reads === 1
              ? '2026-11-11T13:00:00.000000Z'
              : '2026-11-11T13:00:01.500000Z'
          ),
          { status: 200 }
        );
      }
      commits += 1;
      if (commits === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              status: 'FAILED_PRECONDITION',
              message:
                'the stored version (2) does not match the required base version (1)',
            },
          }),
          { status: 400 }
        );
      }
      const payload = JSON.parse(String(init.body)) as {
        writes: Array<{ currentDocument?: unknown }>;
      };
      secondAttemptPreconditions.push(
        payload.writes[0].currentDocument,
        payload.writes[1].currentDocument
      );
      return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
    };
    const retried = await new AuthoritativeSubmissionRepository({
      tokenProvider: okTokenProvider,
      fetcher: conflictThenOk,
    }).persistEvaluation(verifiedUser, evaluation);
    expect(retried).toEqual({ persistedUserState: true, leaderboardSynced: true });
    expect(reads).toBe(2);
    expect(commits).toBe(2);
    // The retry uses the fresh versions it re-read, not the stale ones
    expect(secondAttemptPreconditions).toEqual([
      { updateTime: '2026-11-11T13:00:01.500000Z' },
      { updateTime: '2026-11-11T13:00:01.500000Z' },
    ]);

    // 2. A genuine bad request is not retried and names its cause. Firestore's own
    //    explanation goes to the server log only, never into the response.
    let badCommits = 0;
    const invalidArgument = async (url: string) => {
      if (url.endsWith(':batchGet')) {
        return new Response(batchGetBody('2026-11-11T13:00:00.000000Z'), {
          status: 200,
        });
      }
      badCommits += 1;
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'Invalid value at writes[0].update.fields',
          },
        }),
        { status: 400 }
      );
    };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rejected = await new AuthoritativeSubmissionRepository({
      tokenProvider: okTokenProvider,
      fetcher: invalidArgument,
    }).persistEvaluation(verifiedUser, evaluation);
    const loggedLines = errorLog.mock.calls.map((args) =>
      args.map(String).join(' ')
    );
    errorLog.mockRestore();
    expect(rejected).toEqual({
      persistedUserState: false,
      leaderboardSynced: false,
      failureReason: 'write_http_400',
    });
    expect(badCommits).toBe(1);
    expect(
      loggedLines.some((line) =>
        line.includes(
          'commit failed (400) INVALID_ARGUMENT: Invalid value at writes[0].update.fields'
        )
      )
    ).toBe(true);

    // 3. A permission problem on the first read names its cause too
    const forbiddenRead = async () =>
      new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), {
        status: 403,
      });
    const forbidden = await new AuthoritativeSubmissionRepository({
      tokenProvider: okTokenProvider,
      fetcher: forbiddenRead,
    }).persistEvaluation(verifiedUser, evaluation);
    expect(forbidden.failureReason).toBe('read_http_403');

    // 4. Rejected or missing server credentials must not throw: the judged result is
    //    still returned to the user, flagged as not recorded
    const throwingTokenProvider = {
      resolveAuthContext: async () => {
        throw new Error('Service account OAuth exchange failed (401)');
      },
    } as unknown as ServiceAccountTokenProvider;
    const neverCalled = async () => {
      throw new Error('Firestore must not be called without a token');
    };
    await expect(
      new AuthoritativeSubmissionRepository({
        tokenProvider: throwingTokenProvider,
        fetcher: neverCalled,
      }).persistEvaluation(verifiedUser, evaluation)
    ).resolves.toEqual({
      persistedUserState: false,
      leaderboardSynced: false,
      failureReason: 'server_credentials_rejected',
    });

    const missingTokenProvider = {
      resolveAuthContext: async () => null,
    } as unknown as ServiceAccountTokenProvider;
    await expect(
      new AuthoritativeSubmissionRepository({
        tokenProvider: missingTokenProvider,
        fetcher: neverCalled,
      }).persistEvaluation(verifiedUser, evaluation)
    ).resolves.toMatchObject({
      persistedUserState: false,
      failureReason: 'server_credentials_missing',
    });
  });

  it('validates ProblemCatalog DTO sanitization and TopologyGraphAnalyzer / CacheHitRateEvaluator collaborators', () => {
    const sampleProblem = getProblemById('url-shortener');
    const catalog = new ProblemCatalog([sampleProblem]);
    expect(catalog.findById('url-shortener')?.code).toBe('HLD-201');
    expect(catalog.findById('non-existent')).toBeNull();

    const publicDto = catalog.toPublicSpec(sampleProblem) as unknown as Record<
      string,
      unknown
    >;
    expect(publicDto.idealShardKeys).toBeUndefined();
    expect(publicDto.scatterGatherTrapKeys).toBeUndefined();
    expect(publicDto.workingSetGb).toBeUndefined();

    const compiler = DesignCompiler.createDefault();
    const emptyIr = compiler.compile({
      problemId: sampleProblem.id,
      nodes: [],
      edges: [],
      boundaries: [],
      writeupMarkdown: '',
    });
    const analyzer = new TopologyGraphAnalyzer();
    const emptyTopo = analyzer.analyze(emptyIr, sampleProblem);
    expect(emptyTopo.validTopology).toBe(false);

    const cacheEval = new CacheHitRateEvaluator();
    const cacheIr = compiler.compile({
      problemId: sampleProblem.id,
      nodes: [{ id: 'c1', label: 'Redis Cache', x: 0, y: 0, width: 120, height: 50 }],
      edges: [],
      boundaries: [],
      writeupMarkdown: 'Redis Cache 32 GB RAM TTL 120s with singleflight.',
    });
    const hitExplained = cacheEval.evaluateHitRate(
      cacheIr.nodes[0],
      sampleProblem,
      sampleProblem.waves[0],
      15,
      true
    );
    const hitUnexplained = cacheEval.evaluateHitRate(
      cacheIr.nodes[0],
      sampleProblem,
      sampleProblem.waves[0],
      15,
      false
    );
    expect(hitExplained).toBeDefined();
    expect(hitUnexplained).toBeDefined();
    expect(hitExplained!).toBeGreaterThan(hitUnexplained!);
  });

  it('enforces 60% Write-up / 40% NFR rubric weighting and 4+ standardized FR bullets across all 110 problems', () => {
    const tiers = [
      { diff: 'Easy' as const, max: 500, writeup: 300, nfr: 200 },
      { diff: 'Medium' as const, max: 1000, writeup: 600, nfr: 400 },
      { diff: 'Hard' as const, max: 1500, writeup: 900, nfr: 600 },
      { diff: 'Expert' as const, max: 2000, writeup: 1200, nfr: 800 },
    ];

    for (const tier of tiers) {
      const caps = getRubricCapsForDifficulty(tier.diff);
      expect(caps.maxScore).toBe(tier.max);
      expect(caps.pillars.writeup).toBe(tier.writeup);
      const nfrSum =
        caps.pillars.latency +
        caps.pillars.throughput +
        caps.pillars.resilience +
        caps.pillars.cost +
        caps.pillars.simplicity;
      expect(nfrSum).toBe(tier.nfr);

      const ruleDims = getWriteupRuleDimensions(tier.diff);
      expect(ruleDims.reduce((acc, d) => acc + d.scaledMax, 0)).toBe(tier.writeup);
    }

    expect(PROBLEMS.length).toBe(110);
    const forbiddenHintTokens =
      /\b(snowflake|uuidv7|redis|kafka|dynamodb|postgres|cache-aside|singleflight|cloudfront)\b/i;
    for (const problem of PROBLEMS) {
      expect(problem.functionalRequirements.length).toBeGreaterThanOrEqual(4);
      const pub = toPublicProblemSpec(problem);
      const hint = buildWriteupPlaceholderHint(pub);
      expect(hint).toContain('60% FR & Plain-English Write-up');
      expect(hint).toContain('WA_FUNCTIONAL');
      expect(hint).not.toContain('PLAIN-ENGLISH EXAMPLE STYLE');
      expect(hint).not.toMatch(forbiddenHintTokens);

      const templateBodyWithoutPromptHeadings = buildProblemWriteupTemplate(pub)
        .split('\n')
        .filter((line) => !line.startsWith('### FR-'))
        .join('\n');
      expect(templateBodyWithoutPromptHeadings).not.toMatch(forbiddenHintTokens);
    }
  });

  it('rejects empty write-ups, keyword dumps, prompt copy-pastes, and unfilled templates with WA_FUNCTIONAL, and rewards complete plain-English CRUD write-ups', () => {
    const pastebin = getProblemById('pastebin-snippets');
    const pubPastebin = toPublicProblemSpec(pastebin);
    const judge = new JudgeEngineService({
      simulator: new DiscreteEventSimulator(),
      testSuiteEvaluator: new ProblemTestSuiteEvaluator(),
    });

    const validNodes = [
      { id: 'c', label: 'Users', x: 20, y: 120, width: 120, height: 60 },
      { id: 'cdn', label: 'CloudFront CDN', x: 180, y: 80, width: 150, height: 64 },
      {
        id: 'lb',
        label: 'ALB Load Balancer x2 medium',
        x: 180,
        y: 180,
        width: 150,
        height: 64,
      },
      {
        id: 'api',
        label: 'Snippet API x4 medium || SingleFlight',
        x: 380,
        y: 140,
        width: 170,
        height: 70,
      },
      {
        id: 'redis',
        label: 'Redis Cache x2 16GB || Multi-AZ',
        x: 610,
        y: 80,
        width: 160,
        height: 64,
      },
      {
        id: 'db',
        label: 'DynamoDB Metadata Store 2 shards || Multi-AZ',
        x: 610,
        y: 200,
        width: 170,
        height: 70,
      },
      {
        id: 's3',
        label: 'S3 Blob Object Storage',
        x: 820,
        y: 200,
        width: 160,
        height: 64,
      },
    ];
    const validEdges = [
      { id: 'e1', from: 'c', to: 'cdn' },
      { id: 'e2', from: 'cdn', to: 'lb' },
      { id: 'e3', from: 'lb', to: 'api' },
      { id: 'e4', from: 'api', to: 'redis' },
      { id: 'e5', from: 'api', to: 'db' },
      { id: 'e6', from: 'api', to: 's3' },
    ];

    // 1) Empty write-up -> WA_FUNCTIONAL
    const emptyEval = judge.evaluateSubmission(
      {
        problemId: pastebin.id,
        submissionName: 'Empty Writeup',
        nodes: validNodes,
        edges: validEdges,
        boundaries: [],
        writeupMarkdown: '',
      },
      pastebin
    );
    expect(emptyEval.score.verdict).toBe('WA_FUNCTIONAL');
    expect(emptyEval.ir.functionalAnalysis?.passesFunctionalGate).toBe(false);

    // 2) Keyword-only buzzword list -> WA_FUNCTIONAL
    const spamEval = judge.evaluateSubmission(
      {
        problemId: pastebin.id,
        submissionName: 'Keyword Dump',
        nodes: validNodes,
        edges: validEdges,
        boundaries: [],
        writeupMarkdown:
          'Redis, CloudFront CDN, ALB, Snippet API, DynamoDB, S3, Snowflake, Sharding, Multi-AZ, TTL, Cache-Aside, Quorum, Circuit Breaker',
      },
      pastebin
    );
    expect(spamEval.score.verdict).toBe('WA_FUNCTIONAL');
    expect(spamEval.ir.functionalAnalysis?.prose.isKeywordSpam).toBe(true);

    // 3) Unfilled template scaffold -> WA_FUNCTIONAL (0 free points)
    const unfilledTemplateEval = judge.evaluateSubmission(
      {
        problemId: pastebin.id,
        submissionName: 'Unfilled Template',
        nodes: validNodes,
        edges: validEdges,
        boundaries: [],
        writeupMarkdown: buildProblemWriteupTemplate(pubPastebin),
      },
      pastebin
    );
    expect(unfilledTemplateEval.score.verdict).toBe('WA_FUNCTIONAL');
    expect(unfilledTemplateEval.ir.functionalAnalysis?.frScore).toBe(0);

    // 4) Verbatim copy-paste of problem prompt -> WA_FUNCTIONAL
    const copiedPromptEval = judge.evaluateSubmission(
      {
        problemId: pastebin.id,
        submissionName: 'Copied Prompt',
        nodes: validNodes,
        edges: validEdges,
        boundaries: [],
        writeupMarkdown: [
          pastebin.summary,
          ...pastebin.functionalRequirements,
          pastebin.consistencyDescription,
        ].join(' '),
      },
      pastebin
    );
    expect(copiedPromptEval.score.verdict).toBe('WA_FUNCTIONAL');
    expect(copiedPromptEval.ir.functionalAnalysis?.prose.isPromptCopyPaste).toBe(true);

    // 5) Complete plain-English CRUD + invalidation + failover write-up -> passes FR gate & AC!
    const fullPlainEnglishWriteup = `
      Users connect through CloudFront CDN and the 2-instance ALB Load Balancer to 4 medium stateless Snippet API instances.
      For POST /pastes, the Snippet API generates a lock-free 64-bit Snowflake ID encoded in Base62 as paste_id, writes payloads to S3 Blob Object Storage, and persists metadata in a 2-shard multi-AZ DynamoDB Metadata Store partitioned by salted paste_id.
      For GET /pastes/{paste_id}, CloudFront CDN and a 16 GB multi-AZ Redis Cache (cache-aside with 10-minute TTL and singleflight request coalescing) serve hot snippets in memory, falling back to DynamoDB read replicas and S3 on cache misses.
      For PUT /pastes/{paste_id} and DELETE /pastes/{paste_id}, the Snippet API updates or tombstones the record in DynamoDB, removes expired or deleted blobs via TTL lifecycle rules in S3, and synchronously purges stale keys from Redis Cache and CloudFront CDN.
      Multi-AZ quorum replicas on both Redis Cache and DynamoDB with circuit breakers provide automatic failover and eventual consistency (< 5s propagation) when downstream storage experiences latency brownouts or node crashes.
    `;
    const goodEval = judge.evaluateSubmission(
      {
        problemId: pastebin.id,
        submissionName: 'Complete Plain-English CRUD',
        nodes: validNodes,
        edges: validEdges,
        boundaries: [],
        writeupMarkdown: fullPlainEnglishWriteup,
      },
      pastebin
    );
    expect(goodEval.ir.functionalAnalysis?.passesFunctionalGate).toBe(true);
    expect(goodEval.ir.functionalAnalysis?.coveredCount).toBe(4);
    expect(goodEval.score.verdict).toBe('AC');
    expect(goodEval.score.pillars.writeup).toBeGreaterThanOrEqual(250);
  });

  it('emits deterministic diagramFrHints when diagram omits cache or storage capabilities required by FRs', () => {
    const pastebin = getProblemById('pastebin-snippets');
    const compiler = DesignCompiler.createDefault();
    const ir = compiler.compile(
      {
        problemId: pastebin.id,
        nodes: [
          { id: 'c', label: 'Users', x: 20, y: 100, width: 120, height: 60 },
          { id: 'api', label: 'Snippet API', x: 220, y: 100, width: 140, height: 60 },
          { id: 'db', label: 'Postgres Primary DB', x: 440, y: 100, width: 160, height: 60 },
        ],
        edges: [
          { id: 'e1', from: 'c', to: 'api' },
          { id: 'e2', from: 'api', to: 'db' },
        ],
        boundaries: [],
        writeupMarkdown:
          'Users call the Snippet API which creates, reads, updates, and deletes paste records directly in the Postgres Primary DB partitioned by paste_id.',
      },
      pastebin
    );

    expect(ir.functionalAnalysis).toBeDefined();
    expect(ir.functionalAnalysis!.diagramFrHints.length).toBeGreaterThan(0);
  });

  it('synchronizes standardized question cost rate table 1:1 with CloudCostCalculator BASE_MONTHLY_USD without vendor spoilers', () => {
    expect(BASE_MONTHLY_USD.client).toEqual({ small: 0, medium: 0, large: 0 });
    expect(STANDARDIZED_COST_RATE_TABLE).toHaveLength(12);

    const spoilerRegex = /\b(redis|kafka|dynamodb|postgres|snowflake|cloudfront)\b/i;
    for (const row of STANDARDIZED_COST_RATE_TABLE) {
      const truth = BASE_MONTHLY_USD[row.archetype];
      expect(row.smallUsd).toBe(truth.small);
      expect(row.mediumUsd).toBe(truth.medium);
      expect(row.largeUsd).toBe(truth.large);
      expect(row.categoryLabel).not.toMatch(spoilerRegex);
      expect(row.scalingFormula).not.toMatch(spoilerRegex);
    }

    for (const rule of STANDARDIZED_COST_RULES) {
      expect(rule.detail).not.toMatch(spoilerRegex);
    }
  });
});
