'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { sanitizeSnapshot, type UserProfileDoc } from '@/lib/dbSchema';
import {
  clearGuestDrafts,
  getScopedDraftsKey,
  getScopedRunsKey,
  readAccountDrafts,
  readGuestDrafts,
  readSyncedFingerprint,
  writeGuestDrafts,
  writeSyncedFingerprint,
} from '@/lib/draftStorage';
import {
  draftFingerprint,
  isEmptyDraft,
  mergeGuestDraftsIntoAccount,
  reconcileDraftOnCloudLoad,
} from '@/lib/draftSync';
import {
  loadProblemWorkspaceFromCloud,
  recordSubmissionToCloud,
  saveProblemDraftToCloud,
} from '@/lib/firestoreRepo';
import { createEvaluationStub } from '@/lib/judgeApi';
import type {
  EvaluationResult,
  PublicProblemSpec,
  ScoreBreakdown,
  SubmissionSnapshot,
  VerdictCode,
} from '@/types';

export interface StoredRunRecord {
  submissionId: string;
  submissionName: string;
  submittedAtIso: string;
  problemId: string;
  snapshot: SubmissionSnapshot;
  verdict?: VerdictCode | string;
  totalScore?: number;
  score?: ScoreBreakdown;
  metricsSummary?: {
    weightedP50Ms: number;
    weightedP99Ms: number;
    monthlyCostUsd: number;
    overallAvailabilityPct: number;
  };
}

export const STORAGE_DRAFTS_KEY = 'sysjudge_drafts_v1';
export const STORAGE_RUNS_KEY = 'sysjudge_runs_meta_v1';
export const STORAGE_HEIGHT_KEY = 'sysjudge_canvas_height_v2';
export const STORAGE_LAST_PROBLEM_KEY = 'sysjudge_last_problem_v1';

export { getScopedDraftsKey, getScopedRunsKey };

/** Owner of the drafts currently held in state while nobody is signed in. */
const GUEST_OWNER = 'guest';
const CLOUD_AUTOSAVE_DELAY_MS = 2500;

const VALID_VERDICTS = new Set<VerdictCode>([
  'AC',
  'WA_FUNCTIONAL',
  'WA_CONSISTENCY',
  'TLE_LATENCY_SLO',
  'AVAILABILITY_BREACH',
  'MLE_OVER_BUDGET',
  'INVALID_TOPOLOGY',
]);

function toVerdictCode(v: unknown): VerdictCode {
  if (typeof v === 'string' && VALID_VERDICTS.has(v as VerdictCode)) {
    return v as VerdictCode;
  }
  return 'INVALID_TOPOLOGY';
}

export function cloneSnapshot(snap: SubmissionSnapshot): SubmissionSnapshot {
  return {
    nodes: snap.nodes.map((n) => ({ ...n })),
    edges: snap.edges.map((e) => ({ ...e })),
    boundaries: snap.boundaries.map((b) => ({ ...b })),
    writeupMarkdown: snap.writeupMarkdown,
  };
}

export function snapshotsEqual(
  a: SubmissionSnapshot,
  b: SubmissionSnapshot
): boolean {
  if (a.writeupMarkdown !== b.writeupMarkdown) return false;
  if (
    a.nodes.length !== b.nodes.length ||
    a.edges.length !== b.edges.length ||
    a.boundaries.length !== b.boundaries.length
  ) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export function getDefaultPostRunSplitHeight(snap?: SubmissionSnapshot): number {
  const viewportBase =
    typeof window !== 'undefined'
      ? Math.max(420, Math.min(580, Math.round(window.innerHeight * 0.52)))
      : 520;
  if (!snap) return viewportBase;
  const maxContentY = Math.max(
    0,
    ...snap.nodes.map((n) => n.y + n.height + 52),
    ...snap.boundaries.map((b) => b.y + b.height + 40)
  );
  return Math.max(viewportBase, Math.min(680, maxContentY));
}

function rehydrateStoredRuns(
  raw: string | null
): Record<string, EvaluationResult[]> {
  const rehydrated: Record<string, EvaluationResult[]> = {};
  if (!raw) return rehydrated;
  try {
    const rawMap = JSON.parse(raw) as Record<string, StoredRunRecord[]>;
    if (!rawMap || typeof rawMap !== 'object') return rehydrated;
    for (const [pid, records] of Object.entries(rawMap)) {
      if (!Array.isArray(records)) continue;
      rehydrated[pid] = records.map((rec) =>
        createEvaluationStub({
          submissionId: rec.submissionId,
          submissionName: rec.submissionName,
          submittedAtIso: rec.submittedAtIso,
          problemId: pid,
          snapshot: {
            nodes: rec.snapshot?.nodes ?? [],
            edges: rec.snapshot?.edges ?? [],
            boundaries: rec.snapshot?.boundaries ?? [],
            writeupMarkdown: rec.snapshot?.writeupMarkdown ?? '',
          },
          verdict: toVerdictCode(rec.score?.verdict ?? rec.verdict),
          totalScore: rec.score?.totalScore ?? rec.totalScore ?? 0,
          metricsSummary: rec.metricsSummary,
          fullScore: rec.score,
        })
      );
    }
  } catch {
    // Ignore malformed run history
  }
  return rehydrated;
}

export interface UseCloudWorkspaceSyncParams {
  problem: PublicProblemSpec;
  user: User | null;
  profile: UserProfileDoc | null;
  isDummyUser: boolean;
  recordDummySubmission: (evaluation: EvaluationResult) => void;
  onProblemReset?: () => void;
}

interface PendingCloudSave {
  uid: string;
  problemId: string;
  draft: SubmissionSnapshot;
}

/**
 * Custom hook isolating browser storage of drafts, Cloud Firestore workspace
 * hydration, debounced draft autosave, canvas height preference sync, and
 * server-authoritative submission persistence coordination.
 *
 * Drafts are kept "sticky":
 *  - Every edit is written to this browser at once (guests and signed-in users),
 *    so a reload, even right after typing, restores it.
 *  - A guest's sketches move into the account on sign-in, wherever the account
 *    has no draft of its own.
 *  - For signed-in users the cloud copy is saved 2.5s after the last edit, and
 *    at once when the tab is hidden or the problem is left. When the cloud copy
 *    loads, it no longer replaces newer edits made on this device (see
 *    `reconcileDraftOnCloudLoad`).
 */
export function useCloudWorkspaceSync({
  problem,
  user,
  profile,
  isDummyUser,
  recordDummySubmission,
  onProblemReset,
}: UseCloudWorkspaceSyncParams) {
  const [draftsByProblem, setDraftsByProblem] = useState<
    Record<string, SubmissionSnapshot>
  >({});
  const currentDraft: SubmissionSnapshot = draftsByProblem[problem.id] ?? {
    nodes: [],
    edges: [],
    boundaries: [],
    writeupMarkdown: '',
  };

  const [submissionsByProblem, setSubmissionsByProblem] = useState<
    Record<string, EvaluationResult[]>
  >({});
  const problemSubmissions = submissionsByProblem[problem.id] ?? [];

  const [cloudSaveState, setCloudSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'offline'
  >('idle');
  /** `${uid}:${problemId}` once that problem's cloud copy has been loaded (or failed to load). */
  const [cloudLoadedKey, setCloudLoadedKey] = useState<string | null>(null);
  const lastSavedCloudSnapshotRef = useRef<SubmissionSnapshot | null>(null);
  const pendingCloudSaveRef = useRef<PendingCloudSave | null>(null);

  const [canvasHeight, setCanvasHeight] = useState<number>(540);
  const [hasCustomHeight, setHasCustomHeight] = useState<boolean>(false);
  const [stashedDraftByProblem, setStashedDraftByProblem] = useState<
    Record<string, SubmissionSnapshot | null>
  >({});
  /** Whose drafts `draftsByProblem` currently holds: a uid, `guest`, or null before the first read. */
  const [hydratedOwner, setHydratedOwner] = useState<string | null>(null);

  const onProblemResetRef = useRef(onProblemReset);
  onProblemResetRef.current = onProblemReset;

  const latestDraftsRef = useRef(draftsByProblem);
  latestDraftsRef.current = draftsByProblem;

  const activeCloudKey =
    user?.uid && !isDummyUser ? `${user.uid}:${problem.id}` : null;
  const activeCloudKeyRef = useRef(activeCloudKey);
  activeCloudKeyRef.current = activeCloudKey;

  const updateDraft = useCallback(
    (patch: Partial<SubmissionSnapshot>) => {
      setDraftsByProblem((prev) => {
        const existing = prev[problem.id] ?? {
          nodes: [],
          edges: [],
          boundaries: [],
          writeupMarkdown: '',
        };
        return {
          ...prev,
          [problem.id]: { ...existing, ...patch },
        };
      });
    },
    [problem.id]
  );

  // Read this browser's drafts, canvas height and run stubs for whoever is using the page
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_LAST_PROBLEM_KEY, problem.id);

      const savedHeight = window.localStorage.getItem(STORAGE_HEIGHT_KEY);
      if (savedHeight) {
        const parsedH = Number(savedHeight);
        if (Number.isFinite(parsedH) && parsedH >= 320 && parsedH <= 1600) {
          setCanvasHeight(parsedH);
          setHasCustomHeight(true);
        }
      }
    } catch {
      // Storage unavailable: keep defaults
    }

    // Signed-out visitors never see a signed-in session's drafts or AC/submission
    // state. They keep their own guest sketches, which live under a separate key.
    if (!user?.uid) {
      setDraftsByProblem(readGuestDrafts());
      setSubmissionsByProblem({});
      setStashedDraftByProblem({});
      onProblemResetRef.current?.();
      setHydratedOwner(GUEST_OWNER);
      return;
    }

    // Guest sketches made before signing in move into the account, wherever the
    // account has no draft yet. The guest copy is removed by the save effect below,
    // after the merged drafts are stored under this account.
    const accountDrafts = readAccountDrafts(user.uid);
    const guestDrafts = readGuestDrafts();
    const nextDrafts = mergeGuestDraftsIntoAccount(accountDrafts, guestDrafts);

    // Where the account already has a draft for the open problem, that draft is
    // shown and the guest sketch is kept recoverable for this visit
    // ("Restore unsaved draft" in Previous Runs) instead of being dropped.
    const guestSketch = guestDrafts[problem.id];
    if (
      !isEmptyDraft(guestSketch) &&
      !isEmptyDraft(accountDrafts[problem.id]) &&
      draftFingerprint(guestSketch) !==
        draftFingerprint(accountDrafts[problem.id])
    ) {
      setStashedDraftByProblem((prev) => ({
        ...prev,
        [problem.id]: guestSketch,
      }));
    }

    let savedRunsRaw: string | null = null;
    try {
      savedRunsRaw = window.localStorage.getItem(getScopedRunsKey(user.uid));
    } catch {
      // Storage unavailable: no run history
    }
    const rehydratedSubs = rehydrateStoredRuns(savedRunsRaw);

    const curSubs = rehydratedSubs[problem.id] ?? [];
    if (
      isEmptyDraft(nextDrafts[problem.id]) &&
      curSubs.length > 0 &&
      curSubs[0].snapshot
    ) {
      nextDrafts[problem.id] = cloneSnapshot(curSubs[0].snapshot);
    }

    setDraftsByProblem(nextDrafts);
    setSubmissionsByProblem(rehydratedSubs);
    onProblemResetRef.current?.();
    setHydratedOwner(user.uid);
  }, [problem.id, user?.uid]);

  // Write drafts, canvas height and compact run metadata back to this browser on every change
  useEffect(() => {
    try {
      if (hasCustomHeight) {
        window.localStorage.setItem(STORAGE_HEIGHT_KEY, String(canvasHeight));
      }
      // Right after sign-in or sign-out, state still holds the previous owner's
      // drafts for one render. Never store those under the new owner's key.
      if (hydratedOwner !== (user?.uid ?? GUEST_OWNER)) return;

      if (!user?.uid) {
        writeGuestDrafts(draftsByProblem);
        return;
      }

      window.localStorage.setItem(
        getScopedDraftsKey(user.uid),
        JSON.stringify(draftsByProblem)
      );
      // The guest sketches were merged into these drafts when they were read
      clearGuestDrafts();

      const compactRuns: Record<string, StoredRunRecord[]> = {};
      for (const [pid, list] of Object.entries(submissionsByProblem)) {
        compactRuns[pid] = list.slice(0, 15).map((r) => ({
          submissionId: r.submissionId,
          submissionName: r.submissionName,
          submittedAtIso: r.submittedAtIso,
          problemId: r.problemId,
          snapshot: r.snapshot,
          verdict: r.score.verdict,
          totalScore: r.score.totalScore,
          score: r.score,
        }));
      }
      window.localStorage.setItem(
        getScopedRunsKey(user.uid),
        JSON.stringify(compactRuns)
      );
      window.dispatchEvent(new Event('sysjudge-progress-updated'));
    } catch {
      // Ignore storage quota errors
    }
  }, [
    hydratedOwner,
    user?.uid,
    hasCustomHeight,
    canvasHeight,
    draftsByProblem,
    submissionsByProblem,
  ]);

  // Hydrate problem draft & server-persisted run history from Cloud Firestore
  useEffect(() => {
    lastSavedCloudSnapshotRef.current = null;
    if (!user?.uid || isDummyUser) {
      setCloudLoadedKey(null);
      setCloudSaveState('idle');
      return;
    }

    let cancelled = false;
    const uid = user.uid;
    const problemId = problem.id;
    const loadKey = `${uid}:${problemId}`;

    loadProblemWorkspaceFromCloud(uid, problemId)
      .then(({ problemState, submissions }) => {
        if (cancelled) return;

        if (problemState?.draft) {
          const cloudDraft = sanitizeSnapshot(problemState.draft);
          const localDraft = latestDraftsRef.current[problemId];
          const lastSyncedFingerprint = readSyncedFingerprint(uid, problemId);
          const decision = reconcileDraftOnCloudLoad({
            local: localDraft,
            cloud: cloudDraft,
            lastSyncedFingerprint,
          });
          lastSavedCloudSnapshotRef.current = cloudDraft;

          if (decision === 'use_cloud') {
            // If the copy being replaced holds work this device never uploaded,
            // keep it recoverable ("Restore unsaved draft" in Previous Runs).
            if (
              localDraft &&
              !isEmptyDraft(localDraft) &&
              draftFingerprint(localDraft) !== lastSyncedFingerprint
            ) {
              const replaced = cloneSnapshot(localDraft);
              setStashedDraftByProblem((prev) => ({
                ...prev,
                [problemId]: replaced,
              }));
            }
            setDraftsByProblem((prev) => ({
              ...prev,
              [problemId]: cloudDraft,
            }));
          }
          if (decision !== 'keep_local') {
            writeSyncedFingerprint(uid, problemId, draftFingerprint(cloudDraft));
          }
          // 'keep_local': this device has newer edits; the autosave effect below
          // uploads them as soon as `cloudLoadedKey` is set.
        } else if (submissions.length > 0 && submissions[0].snapshot) {
          const fallbackSnap = cloneSnapshot(submissions[0].snapshot);
          lastSavedCloudSnapshotRef.current = fallbackSnap;
          setDraftsByProblem((prev) =>
            isEmptyDraft(prev[problemId])
              ? { ...prev, [problemId]: fallbackSnap }
              : prev
          );
        }

        if (submissions.length > 0) {
          setSubmissionsByProblem((prev) => {
            const existing = prev[problemId] ?? [];
            const hydratedById = new Map(
              existing
                .filter((e) => e.frames.length > 0)
                .map((e) => [e.submissionId, e])
            );
            return {
              ...prev,
              [problemId]: submissions.map(
                (s) => hydratedById.get(s.submissionId) ?? s
              ),
            };
          });
        }

        setCloudLoadedKey(loadKey);
        setCloudSaveState('saved');
      })
      .catch(() => {
        if (!cancelled) {
          setCloudLoadedKey(loadKey);
          setCloudSaveState('offline');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.uid, isDummyUser, problem.id]);

  // Apply cloud-synced vertical canvas height preference if available
  useEffect(() => {
    if (
      profile?.canvasHeight &&
      !hasCustomHeight &&
      profile.canvasHeight >= 320 &&
      profile.canvasHeight <= 1600
    ) {
      setCanvasHeight(profile.canvasHeight);
      setHasCustomHeight(true);
    }
  }, [profile?.canvasHeight, hasCustomHeight]);

  /** Uploads the draft waiting for the autosave timer, if any, right now. */
  const flushPendingCloudSave = useCallback(() => {
    const pending = pendingCloudSaveRef.current;
    if (!pending) return;
    pendingCloudSaveRef.current = null;

    const pendingKey = `${pending.uid}:${pending.problemId}`;
    saveProblemDraftToCloud(pending.uid, pending.problemId, pending.draft)
      .then(() => {
        writeSyncedFingerprint(
          pending.uid,
          pending.problemId,
          draftFingerprint(pending.draft)
        );
        if (activeCloudKeyRef.current !== pendingKey) return;
        lastSavedCloudSnapshotRef.current = pending.draft;
        // A newer edit may already be waiting for its own save
        if (!pendingCloudSaveRef.current) setCloudSaveState('saved');
      })
      .catch(() => {
        if (activeCloudKeyRef.current === pendingKey) {
          setCloudSaveState('offline');
        }
      });
  }, []);

  // Debounced autosave of the active problem draft to Cloud Firestore
  useEffect(() => {
    if (!user?.uid || isDummyUser) return;
    const loadKey = `${user.uid}:${problem.id}`;
    if (cloudLoadedKey !== loadKey) return;

    if (isEmptyDraft(currentDraft) && !lastSavedCloudSnapshotRef.current) return;

    if (
      lastSavedCloudSnapshotRef.current &&
      draftFingerprint(lastSavedCloudSnapshotRef.current) ===
        draftFingerprint(currentDraft)
    ) {
      // Edited and then changed back before the timer fired: nothing left to upload
      if (pendingCloudSaveRef.current) {
        pendingCloudSaveRef.current = null;
        setCloudSaveState('saved');
      }
      return;
    }

    setCloudSaveState('saving');
    pendingCloudSaveRef.current = {
      uid: user.uid,
      problemId: problem.id,
      draft: cloneSnapshot(currentDraft),
    };

    const timer = setTimeout(flushPendingCloudSave, CLOUD_AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    user?.uid,
    isDummyUser,
    problem.id,
    currentDraft,
    cloudLoadedKey,
    flushPendingCloudSave,
  ]);

  // Do not drop an unsaved draft when the problem or account changes, or the page closes
  useEffect(() => {
    return () => {
      flushPendingCloudSave();
    };
  }, [user?.uid, isDummyUser, problem.id, flushPendingCloudSave]);

  // ...or when the tab is hidden (switching apps on a phone, closing the tab)
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') flushPendingCloudSave();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushPendingCloudSave);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushPendingCloudSave);
    };
  }, [flushPendingCloudSave]);

  const recordEvaluatedSubmission = useCallback(
    (evaluation: EvaluationResult) => {
      setSubmissionsByProblem((prev) => ({
        ...prev,
        [problem.id]: [evaluation, ...(prev[problem.id] ?? [])],
      }));
      setStashedDraftByProblem((prev) => ({ ...prev, [problem.id]: null }));

      if (!hasCustomHeight) {
        setCanvasHeight(getDefaultPostRunSplitHeight(evaluation.snapshot));
      }

      if (isDummyUser) {
        recordDummySubmission(evaluation);
      } else if (user) {
        const uid = user.uid;
        const problemId = evaluation.problemId;
        const markSnapshotSynced = () => {
          writeSyncedFingerprint(
            uid,
            problemId,
            draftFingerprint(evaluation.snapshot)
          );
          if (activeCloudKeyRef.current !== `${uid}:${problemId}`) return;
          lastSavedCloudSnapshotRef.current = cloneSnapshot(evaluation.snapshot);
          if (!pendingCloudSaveRef.current) setCloudSaveState('saved');
        };

        if (evaluation.integrity?.submissionPersistedOnServer) {
          markSnapshotSynced();
        } else {
          setCloudSaveState('saving');
          recordSubmissionToCloud(user, profile, evaluation)
            .then(markSnapshotSynced)
            .catch(() => {
              if (activeCloudKeyRef.current === `${uid}:${problemId}`) {
                setCloudSaveState('offline');
              }
            });
        }
      }
    },
    [hasCustomHeight, isDummyUser, problem.id, profile, recordDummySubmission, user]
  );

  return {
    draftsByProblem,
    setDraftsByProblem,
    currentDraft,
    updateDraft,
    submissionsByProblem,
    setSubmissionsByProblem,
    problemSubmissions,
    cloudSaveState,
    canvasHeight,
    setCanvasHeight,
    hasCustomHeight,
    setHasCustomHeight,
    stashedDraftByProblem,
    setStashedDraftByProblem,
    recordEvaluatedSubmission,
  };
}
