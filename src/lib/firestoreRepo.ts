import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type {
  EvaluationResult,
  ScoreBreakdown,
  SubmissionSnapshot,
  VerdictCode,
} from '@/types';
import { getFirestoreDb } from '@/lib/firebase';
import {
  type ProblemStateDoc,
  sanitizeSnapshot,
  SCHEMA_LIMITS,
  type SubmissionDoc,
  type UserProfileDoc,
} from '@/lib/dbSchema';
import { createEvaluationStub, evaluateDesignViaApi } from '@/lib/judgeApi';

export interface LegacyLocalRunRecord {
  submissionId: string;
  submissionName: string;
  submittedAtIso: string;
  problemId: string;
  snapshot: SubmissionSnapshot;
  verdict?: VerdictCode | string;
  totalScore?: number;
  score?: ScoreBreakdown;
}

const VALID_PROBLEM_ID_RE = /^[a-z0-9][a-z0-9-]{1,98}$/;

const VALID_VERDICTS = new Set<VerdictCode>([
  'AC',
  'WA_FUNCTIONAL',
  'WA_CONSISTENCY',
  'TLE_LATENCY_SLO',
  'AVAILABILITY_BREACH',
  'MLE_OVER_BUDGET',
  'INVALID_TOPOLOGY',
]);

/**
 * Object-Oriented Repository encapsulating Cloud Firestore client reads,
 * initial empty profile provisioning, preference updates, and debounced draft
 * autosaves. All graded submissions, `progressSummary`, `stats`, `bestScore`,
 * and `bestVerdict` writes execute exclusively on the Judge server inside
 * `/api/judge/evaluate`.
 */
export class UserWorkspaceRepository {
  private readonly dbResolver: () => Firestore;

  public constructor(dbResolver?: () => Firestore) {
    this.dbResolver = dbResolver ?? (() => getFirestoreDb());
  }

  public async ensureProfileAndSyncLocal(
    user: User,
    localDrafts: Record<string, SubmissionSnapshot>,
    localRuns: Record<string, LegacyLocalRunRecord[]>,
    preferredTheme?: 'light' | 'dark',
    canvasHeight?: number
  ): Promise<UserProfileDoc> {
    const db = this.dbResolver();
    const userRef = doc(db, 'users', user.uid);
    const existingSnap = await getDoc(userRef);
    const identity = this.sanitizeUserIdentity(user);

    const existingData = existingSnap.exists()
      ? (existingSnap.data() as UserProfileDoc)
      : null;

    const validHeight =
      typeof canvasHeight === 'number' &&
      Number.isFinite(canvasHeight) &&
      canvasHeight >= 320 &&
      canvasHeight <= 1600
        ? Math.round(canvasHeight)
        : existingData?.canvasHeight;
    const validTheme =
      preferredTheme === 'light' || preferredTheme === 'dark'
        ? preferredTheme
        : existingData?.preferredTheme;

    if (!existingData) {
      const initialProfile: UserProfileDoc = {
        uid: user.uid,
        email: identity.email,
        displayName: identity.displayName,
        photoURL: identity.photoURL,
        ...(validTheme ? { preferredTheme: validTheme } : {}),
        ...(validHeight !== undefined ? { canvasHeight: validHeight } : {}),
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
      };
      await setDoc(userRef, initialProfile);
    } else {
      await updateDoc(userRef, {
        email: identity.email,
        displayName: identity.displayName,
        photoURL: identity.photoURL,
        ...(validTheme ? { preferredTheme: validTheme } : {}),
        ...(validHeight !== undefined ? { canvasHeight: validHeight } : {}),
        updatedAt: serverTimestamp(),
      });
    }

    const migrationKey = `judgesystem_cloud_migrated_v3_${user.uid}`;
    const alreadyMigrated =
      typeof window !== 'undefined' &&
      window.localStorage.getItem(migrationKey) === '1';

    if (!alreadyMigrated) {
      const touchedProblemIds = new Set<string>([
        ...Object.keys(localDrafts),
        ...Object.keys(localRuns),
      ]);

      for (const pid of touchedProblemIds) {
        if (!VALID_PROBLEM_ID_RE.test(pid)) continue;

        const runs = Array.isArray(localRuns[pid])
          ? localRuns[pid].slice(0, 3)
          : [];
        const localDraft = localDrafts[pid];
        const hasDraft = this.isNonEmptySnapshot(localDraft);

        if (runs.length === 0 && !hasDraft) continue;

        const probRef = doc(db, 'users', user.uid, 'problemStates', pid);
        const probSnap = await getDoc(probRef);
        if (probSnap.exists()) continue;

        let replayedAny = false;
        for (const rec of [...runs].reverse()) {
          if (!rec || !rec.snapshot) continue;
          try {
            await evaluateDesignViaApi({
              problemId: pid,
              snapshot: sanitizeSnapshot(rec.snapshot),
              submissionName: String(rec.submissionName || 'Migrated Run').slice(0, 80),
            });
            replayedAny = true;
          } catch {
            // Continue gracefully if server persistence is unconfigured
          }
        }

        if (hasDraft) {
          try {
            await this.saveDraft(user.uid, pid, localDraft);
          } catch {
            // Ignore draft migration warning
          }
        } else if (!replayedAny && runs[0]?.snapshot) {
          try {
            await this.saveDraft(user.uid, pid, runs[0].snapshot);
          } catch {
            // Ignore draft migration warning
          }
        }
      }

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(migrationKey, '1');
        } catch {
          // Ignore storage quota errors
        }
      }
    }

    const freshSnap = await getDoc(userRef);
    return (freshSnap.data() as UserProfileDoc) ?? {
      uid: user.uid,
      email: identity.email,
      displayName: identity.displayName,
      photoURL: identity.photoURL,
      stats: {
        acceptedCount: 0,
        attemptedCount: 0,
        totalSubmissions: 0,
        totalBestScore: 0,
      },
      progressSummary: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  }

  public subscribeToProfile(
    uid: string,
    onProfile: (profile: UserProfileDoc | null) => void,
    onError?: (err: unknown) => void
  ): () => void {
    const db = this.dbResolver();
    const userRef = doc(db, 'users', uid);
    return onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          onProfile(snap.data() as UserProfileDoc);
        } else {
          onProfile(null);
        }
      },
      (err) => {
        if (onError) onError(err);
      }
    );
  }

  public async loadWorkspace(
    uid: string,
    problemId: string
  ): Promise<{
    problemState: ProblemStateDoc | null;
    submissions: EvaluationResult[];
  }> {
    const db = this.dbResolver();
    const probRef = doc(db, 'users', uid, 'problemStates', problemId);
    const subsQuery = query(
      collection(db, 'users', uid, 'problemStates', problemId, 'submissions'),
      orderBy('submittedAtMs', 'desc'),
      limit(SCHEMA_LIMITS.recentRunsLimit)
    );

    const [probSnap, subsSnap] = await Promise.all([
      getDoc(probRef),
      getDocs(subsQuery),
    ]);

    const problemState = probSnap.exists()
      ? (probSnap.data() as ProblemStateDoc)
      : null;

    const submissions: EvaluationResult[] = subsSnap.docs.map((docSnap) => {
      const data = docSnap.data() as SubmissionDoc;
      const cleanSnap = sanitizeSnapshot(data.snapshot);
      return createEvaluationStub({
        submissionId: data.submissionId,
        submissionName: data.submissionName,
        submittedAtIso: data.submittedAtIso,
        problemId,
        snapshot: cleanSnap,
        verdict: this.normalizeVerdict(data.verdict),
        totalScore: data.totalScore,
        pillars: data.pillars,
        metricsSummary: data.metricsSummary,
      });
    });

    return { problemState, submissions };
  }

  public async saveDraft(
    uid: string,
    problemId: string,
    draft: SubmissionSnapshot,
    _meta?: {
      bestScore: number;
      bestVerdict: VerdictCode | null;
      runsCount: number;
    }
  ): Promise<void> {
    const db = this.dbResolver();
    const probRef = doc(db, 'users', uid, 'problemStates', problemId);
    const cleanDraft = sanitizeSnapshot(draft);

    try {
      await updateDoc(probRef, {
        draft: cleanDraft,
        updatedAt: serverTimestamp(),
      });
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      // A draft that was never saved has no document yet. The failed update then
      // surfaces as `permission-denied`, not `not-found`: the security rule for
      // `update` cannot be evaluated against a missing document. Checking only for
      // `not-found` meant the first save of every problem failed and no draft ever
      // reached the cloud. So try to create the initial document in both cases.
      // If the document does exist, the rules reject this write whenever it would
      // change a grading field, so it can never overwrite a score.
      const documentMayBeMissing =
        code === 'not-found' ||
        code.endsWith('/not-found') ||
        code === 'permission-denied' ||
        code.endsWith('/permission-denied');
      if (documentMayBeMissing) {
        const initialState: ProblemStateDoc = {
          uid,
          problemId,
          draft: cleanDraft,
          bestScore: 0,
          bestVerdict: null,
          runsCount: 0,
          updatedAt: serverTimestamp(),
        };
        try {
          await setDoc(probRef, initialState);
          return;
        } catch {
          // Report the original failure
          throw err;
        }
      }
      throw err;
    }
  }

  /**
   * Submissions, verdicts, scores, and progressSummary are persisted exclusively
   * on the server inside `/api/judge/evaluate`. If server persistence was not yet
   * configured (e.g., local sandbox without `FIREBASE_SERVICE_ACCOUNT_JSON`),
   * this method safely persists only the ungraded canvas draft.
   */
  public async recordSubmission(
    user: User,
    _existingProfile: UserProfileDoc | null,
    evaluation: EvaluationResult
  ): Promise<void> {
    if (evaluation.integrity?.submissionPersistedOnServer) {
      return;
    }
    await this.saveDraft(user.uid, evaluation.problemId, evaluation.snapshot);
  }

  public async updatePreferences(
    user: User,
    existingProfile: UserProfileDoc,
    prefs: {
      preferredTheme?: 'light' | 'dark';
      canvasHeight?: number;
    }
  ): Promise<void> {
    const db = this.dbResolver();
    const userRef = doc(db, 'users', user.uid);

    const nextTheme = prefs.preferredTheme ?? existingProfile.preferredTheme;
    const nextHeight =
      typeof prefs.canvasHeight === 'number' &&
      Number.isFinite(prefs.canvasHeight) &&
      prefs.canvasHeight >= 320 &&
      prefs.canvasHeight <= 1600
        ? Math.round(prefs.canvasHeight)
        : existingProfile.canvasHeight;

    await updateDoc(userRef, {
      ...(nextTheme ? { preferredTheme: nextTheme } : {}),
      ...(nextHeight !== undefined ? { canvasHeight: nextHeight } : {}),
      updatedAt: serverTimestamp(),
    });
  }

  private normalizeVerdict(v: unknown): VerdictCode {
    if (typeof v === 'string' && VALID_VERDICTS.has(v as VerdictCode)) {
      return v as VerdictCode;
    }
    return 'INVALID_TOPOLOGY';
  }

  private sanitizeUserIdentity(user: User) {
    const email =
      typeof user.email === 'string' && user.email.includes('@')
        ? user.email.slice(0, 254)
        : null;
    const displayName =
      typeof user.displayName === 'string' && user.displayName.trim().length > 0
        ? user.displayName.trim().slice(0, 120)
        : null;
    const photoURL =
      typeof user.photoURL === 'string' &&
      (user.photoURL.startsWith('https://') ||
        user.photoURL.startsWith('http://'))
        ? user.photoURL.slice(0, 2048)
        : null;

    return { email, displayName, photoURL };
  }

  private isNonEmptySnapshot(snap?: SubmissionSnapshot | null): boolean {
    if (!snap) return false;
    return (
      (Array.isArray(snap.nodes) && snap.nodes.length > 0) ||
      (Array.isArray(snap.boundaries) && snap.boundaries.length > 0) ||
      (typeof snap.writeupMarkdown === 'string' &&
        snap.writeupMarkdown.trim().length > 0)
    );
  }
}

export const defaultUserWorkspaceRepository = new UserWorkspaceRepository();

export async function ensureUserProfileAndSyncLocal(
  user: User,
  localDrafts: Record<string, SubmissionSnapshot>,
  localRuns: Record<string, LegacyLocalRunRecord[]>,
  preferredTheme?: 'light' | 'dark',
  canvasHeight?: number
): Promise<UserProfileDoc> {
  return defaultUserWorkspaceRepository.ensureProfileAndSyncLocal(
    user,
    localDrafts,
    localRuns,
    preferredTheme,
    canvasHeight
  );
}

export function subscribeToUserProfile(
  uid: string,
  onProfile: (profile: UserProfileDoc | null) => void,
  onError?: (err: unknown) => void
): () => void {
  return defaultUserWorkspaceRepository.subscribeToProfile(
    uid,
    onProfile,
    onError
  );
}

export async function loadProblemWorkspaceFromCloud(
  uid: string,
  problemId: string
): Promise<{
  problemState: ProblemStateDoc | null;
  submissions: EvaluationResult[];
}> {
  return defaultUserWorkspaceRepository.loadWorkspace(uid, problemId);
}

export async function saveProblemDraftToCloud(
  uid: string,
  problemId: string,
  draft: SubmissionSnapshot,
  meta?: {
    bestScore: number;
    bestVerdict: VerdictCode | null;
    runsCount: number;
  }
): Promise<void> {
  return defaultUserWorkspaceRepository.saveDraft(uid, problemId, draft, meta);
}

export async function recordSubmissionToCloud(
  user: User,
  existingProfile: UserProfileDoc | null,
  evaluation: EvaluationResult
): Promise<void> {
  return defaultUserWorkspaceRepository.recordSubmission(
    user,
    existingProfile,
    evaluation
  );
}

export async function updateUserPreferencesInCloud(
  user: User,
  existingProfile: UserProfileDoc,
  prefs: {
    preferredTheme?: 'light' | 'dark';
    canvasHeight?: number;
  }
): Promise<void> {
  return defaultUserWorkspaceRepository.updatePreferences(
    user,
    existingProfile,
    prefs
  );
}
