import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  type Firestore,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UserWorkspaceRepository } from '@/lib/firestoreRepo';

const PROJECT_ID = 'demo-judge-system';
const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');

let testEnv: RulesTestEnvironment;

const SAMPLE_SNAPSHOT = {
  nodes: [{ id: 'n1', label: 'Redis Cache', x: 100, y: 100, width: 140, height: 64 }],
  edges: [],
  boundaries: [],
  writeupMarkdown: '# Design\nUsing Redis cache-aside.',
};

describe('Firestore Security Rules (Live Emulator Verification)', () => {
  beforeAll(async () => {
    const hostPort = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
    const [host, portStr] = hostPort.split(':');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: host || '127.0.0.1',
        port: Number(portStr) || 8080,
        rules: readFileSync(RULES_PATH, 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  it('allows owner to create an empty zeroed profile, blocks spoofed stats, and blocks non-owner PII reads', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const bobDb = testEnv.authenticatedContext('bob').firestore();

    // Reject spoofed initial stats
    await assertFails(
      setDoc(doc(aliceDb, 'users', 'alice'), {
        uid: 'alice',
        email: 'alice@example.com',
        displayName: 'Alice',
        photoURL: null,
        stats: {
          acceptedCount: 10,
          attemptedCount: 10,
          totalSubmissions: 10,
          totalBestScore: 9500,
        },
        progressSummary: {
          'url-shortener': {
            status: 'ac',
            bestScore: 950,
            bestVerdict: 'AC',
            runsCount: 1,
            lastSubmittedAtMs: Date.now(),
          },
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Allow legitimate zeroed profile creation
    await assertSucceeds(
      setDoc(doc(aliceDb, 'users', 'alice'), {
        uid: 'alice',
        email: 'alice@example.com',
        displayName: 'Alice',
        photoURL: null,
        stats: {
          acceptedCount: 0,
          attemptedCount: 0,
          totalSubmissions: 0,
          totalBestScore: 0,
        },
        progressSummary: {},
        activityByDate: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Non-owner cannot read PII profile
    await assertFails(getDoc(doc(bobDb, 'users', 'alice')));

    // Owner can update UI preferences without touching stats/progressSummary
    await assertSucceeds(
      updateDoc(doc(aliceDb, 'users', 'alice'), {
        preferredTheme: 'dark',
        canvasHeight: 680,
        updatedAt: serverTimestamp(),
      })
    );

    // Owner cannot self-promote stats, progressSummary, or rating on update
    await assertFails(
      updateDoc(doc(aliceDb, 'users', 'alice'), {
        'stats.acceptedCount': 1,
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(doc(aliceDb, 'users', 'alice'), {
        rating: 2600,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('locks /submissions to server-only writes while allowing client draft autosaves without overwriting server AC verdicts', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();

    // Client cannot write directly to /submissions
    await assertFails(
      setDoc(
        doc(
          aliceDb,
          'users',
          'alice',
          'problemStates',
          'url-shortener',
          'submissions',
          'sub_spoofed'
        ),
        {
          uid: 'alice',
          submissionId: 'sub_spoofed',
          submissionName: 'Spoofed AC',
          problemId: 'url-shortener',
          submittedAtIso: new Date().toISOString(),
          submittedAtMs: Date.now(),
          verdict: 'AC',
          totalScore: 990,
          pillars: {
            latency: 250,
            throughput: 200,
            resilience: 200,
            cost: 150,
            writeup: 140,
            simplicity: 50,
          },
          metricsSummary: {
            weightedP50Ms: 5,
            weightedP99Ms: 18,
            monthlyCostUsd: 900,
            overallAvailabilityPct: 99.99,
          },
          snapshot: SAMPLE_SNAPSHOT,
          createdAt: serverTimestamp(),
        }
      )
    );

    // Client cannot create problemState with spoofed bestVerdict: 'AC'
    await assertFails(
      setDoc(doc(aliceDb, 'users', 'alice', 'problemStates', 'url-shortener'), {
        uid: 'alice',
        problemId: 'url-shortener',
        draft: SAMPLE_SNAPSHOT,
        bestScore: 950,
        bestVerdict: 'AC',
        runsCount: 1,
        updatedAt: serverTimestamp(),
      })
    );

    // Simulate server persisting an AC verdict + submission via Admin / Service Account
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      const now = Timestamp.now();
      await setDoc(
        doc(adminDb, 'users', 'alice', 'problemStates', 'url-shortener'),
        {
          uid: 'alice',
          problemId: 'url-shortener',
          draft: SAMPLE_SNAPSHOT,
          bestScore: 915,
          bestVerdict: 'AC',
          runsCount: 2,
          updatedAt: now,
        }
      );
      await setDoc(
        doc(
          adminDb,
          'users',
          'alice',
          'problemStates',
          'url-shortener',
          'submissions',
          'sub_server_1'
        ),
        {
          uid: 'alice',
          submissionId: 'sub_server_1',
          submissionName: 'Server Graded Run',
          problemId: 'url-shortener',
          submittedAtIso: new Date().toISOString(),
          submittedAtMs: Date.now(),
          verdict: 'AC',
          totalScore: 915,
          snapshot: SAMPLE_SNAPSHOT,
          createdAt: now,
        }
      );
    });

    // Owner CAN read server-persisted submission
    const subSnap = await assertSucceeds(
      getDoc(
        doc(
          aliceDb,
          'users',
          'alice',
          'problemStates',
          'url-shortener',
          'submissions',
          'sub_server_1'
        )
      )
    );
    expect(subSnap.exists()).toBe(true);

    // Owner CAN still autosave canvas draft without losing bestVerdict: 'AC'
    await assertSucceeds(
      updateDoc(
        doc(aliceDb, 'users', 'alice', 'problemStates', 'url-shortener'),
        {
          draft: {
            ...SAMPLE_SNAPSHOT,
            writeupMarkdown: '# Updated Draft\nRefined writeup.',
          },
          updatedAt: serverTimestamp(),
        }
      )
    );
  });

  it('saves a first draft through the app repository when no document exists yet, and never overwrites server grading', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const aliceRepo = new UserWorkspaceRepository(
      () => aliceDb as unknown as Firestore
    );
    const probRef = doc(
      aliceDb,
      'users',
      'alice',
      'problemStates',
      'url-shortener'
    );

    // A bare update on a missing document is rejected as permission-denied (not
    // not-found), because the `update` rule cannot be evaluated without a document
    await assertFails(
      updateDoc(probRef, {
        draft: SAMPLE_SNAPSHOT,
        updatedAt: serverTimestamp(),
      })
    );

    // ...so saveDraft() has to create the document itself on the first save
    await aliceRepo.saveDraft('alice', 'url-shortener', SAMPLE_SNAPSHOT);
    let snap = await getDoc(probRef);
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.draft.writeupMarkdown).toBe(
      SAMPLE_SNAPSHOT.writeupMarkdown
    );
    expect(snap.data()?.bestScore).toBe(0);
    expect(snap.data()?.bestVerdict).toBeNull();

    // Later saves update the same document
    await aliceRepo.saveDraft('alice', 'url-shortener', {
      ...SAMPLE_SNAPSHOT,
      writeupMarkdown: 'Second version of the draft.',
    });
    snap = await getDoc(probRef);
    expect(snap.data()?.draft.writeupMarkdown).toBe(
      'Second version of the draft.'
    );

    // Once the server has recorded a graded run, a draft save keeps the grade
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'users', 'alice', 'problemStates', 'url-shortener'),
        {
          uid: 'alice',
          problemId: 'url-shortener',
          draft: SAMPLE_SNAPSHOT,
          bestScore: 915,
          bestVerdict: 'AC',
          runsCount: 2,
          updatedAt: Timestamp.now(),
        }
      );
    });
    await aliceRepo.saveDraft('alice', 'url-shortener', {
      ...SAMPLE_SNAPSHOT,
      writeupMarkdown: 'Third version, after an accepted run.',
    });
    snap = await getDoc(probRef);
    expect(snap.data()?.draft.writeupMarkdown).toBe(
      'Third version, after an accepted run.'
    );
    expect(snap.data()?.bestScore).toBe(915);
    expect(snap.data()?.bestVerdict).toBe('AC');
    expect(snap.data()?.runsCount).toBe(2);

    // Nobody else can write this user's draft, missing or not
    const bobRepo = new UserWorkspaceRepository(
      () =>
        testEnv.authenticatedContext('bob').firestore() as unknown as Firestore
    );
    await expect(
      bobRepo.saveDraft('alice', 'url-shortener', SAMPLE_SNAPSHOT)
    ).rejects.toBeTruthy();
    await expect(
      bobRepo.saveDraft('alice', 'rate-limiter', SAMPLE_SNAPSHOT)
    ).rejects.toBeTruthy();
  });

  it('blocks client writes to /leaderboard and blocks client reads of /problemInternalSpecs', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await setDoc(doc(adminDb, 'problemInternalSpecs', 'url-shortener'), {
        idealShardKeys: ['short_code'],
      });
    });

    await assertFails(
      setDoc(doc(aliceDb, 'leaderboard', 'alice'), {
        uid: 'alice',
        handle: 'Alice',
        totalBestScore: 99999,
      })
    );
    await assertFails(
      getDoc(doc(aliceDb, 'problemInternalSpecs', 'url-shortener'))
    );
  });

  it('enforces server-verified AC gate on community solutions and transactional vote binding (Path B1)', async () => {
    const unverifiedDb = testEnv.authenticatedContext('mallory').firestore();
    const solverDb = testEnv.authenticatedContext('solver').firestore();
    const voterDb = testEnv.authenticatedContext('voter').firestore();

    // Seed server-verified AC state for 'solver'
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await setDoc(
        doc(adminDb, 'users', 'solver', 'problemStates', 'url-shortener'),
        {
          uid: 'solver',
          problemId: 'url-shortener',
          draft: SAMPLE_SNAPSHOT,
          bestScore: 920,
          bestVerdict: 'AC',
          runsCount: 1,
          updatedAt: Timestamp.now(),
        }
      );
    });

    const basePost = {
      postId: 'post_sol_1',
      category: 'solution',
      title: 'Geo-Distributed Redis + DynamoDB URL Shortener',
      previewExcerpt: 'Sub-20ms p99 architecture walkthrough.',
      bodyMarkdown: null,
      tags: ['caching', 'sharding'],
      companyTag: null,
      roleTag: null,
      problemId: 'url-shortener',
      problemCode: 'HLD-001',
      problemTitle: 'URL Shortener',
      solutionMetrics: {
        p99Ms: 14,
        availabilityPct: 99.99,
        monthlyCostUsd: 1120,
        totalScore: 920,
        verdict: 'AC',
      },
      upvotes: 0,
      downvotes: 0,
      netVotes: 0,
      commentCount: 0,
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // Unverified user CANNOT publish a solution post
    await assertFails(
      setDoc(doc(unverifiedDb, 'communityPosts', 'post_sol_1'), {
        ...basePost,
        authorUid: 'mallory',
        authorName: 'Mallory',
        authorPhotoURL: null,
      })
    );

    // Verified AC solver CAN publish a solution post
    await assertSucceeds(
      setDoc(doc(solverDb, 'communityPosts', 'post_sol_1'), {
        ...basePost,
        authorUid: 'solver',
        authorName: 'Solver',
        authorPhotoURL: null,
      })
    );

    // Voter CANNOT inflate upvotes without mutating their /votes/{uid} document
    await assertFails(
      updateDoc(doc(voterDb, 'communityPosts', 'post_sol_1'), {
        upvotes: 1,
        netVotes: 1,
        updatedAt: serverTimestamp(),
      })
    );

    // Voter CAN cast an atomic transactional upvote bound to /votes/voter
    await assertSucceeds(
      runTransaction(voterDb, async (tx) => {
        const postRef = doc(voterDb, 'communityPosts', 'post_sol_1');
        const voteRef = doc(
          voterDb,
          'communityPosts',
          'post_sol_1',
          'votes',
          'voter'
        );
        tx.set(voteRef, {
          uid: 'voter',
          postId: 'post_sol_1',
          value: 1,
          updatedAt: serverTimestamp(),
        });
        tx.update(postRef, {
          upvotes: 1,
          downvotes: 0,
          netVotes: 1,
          updatedAt: serverTimestamp(),
        });
      })
    );

    // Non-author CAN increment commentCount by +1 via Path B2 without hitting AST limits
    await assertSucceeds(
      updateDoc(doc(voterDb, 'communityPosts', 'post_sol_1'), {
        commentCount: 1,
        updatedAt: serverTimestamp(),
      })
    );
  });
});
