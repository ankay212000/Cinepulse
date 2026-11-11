'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Lock,
  Play,
  Share2,
  Smartphone,
  X,
} from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import { useAuth } from '@/components/AuthProvider';
import WhiteboardCanvas from '@/components/WhiteboardCanvas';
import TelemetryCharts from '@/components/TelemetryCharts';
import ScorecardPanel from '@/components/ScorecardPanel';
import TestCasesPanel from '@/components/TestCasesPanel';
import ArenaLeftSidebar, {
  difficultyBadgeClass,
  difficultyTextClass,
} from '@/components/arena/ArenaLeftSidebar';
import DesignWriteupPane from '@/components/arena/DesignWriteupPane';
import ReplayScrubberBar from '@/components/arena/ReplayScrubberBar';
import {
  cloneSnapshot,
  snapshotsEqual,
  STORAGE_DRAFTS_KEY,
  STORAGE_HEIGHT_KEY,
  STORAGE_LAST_PROBLEM_KEY,
  STORAGE_RUNS_KEY,
  type StoredRunRecord,
  useCloudWorkspaceSync,
} from '@/components/arena/useCloudWorkspaceSync';
import { useSimulationPlayback } from '@/components/arena/useSimulationPlayback';
import { computeDraftWriteupStats } from '@/lib/draftStats';
import { wasResultLeftUnsaved } from '@/lib/draftSync';
import { evaluateDesignViaApi, runSampleTestsViaApi } from '@/lib/judgeApi';
import type {
  CustomTestCaseInput,
  PublicProblemNavLink,
  PublicProblemSpec,
  PublicProblemSummary,
  SolutionMetricsBadge,
  SubmissionSnapshot,
  TestSuiteSummary,
} from '@/types';

export {
  difficultyBadgeClass,
  difficultyTextClass,
  STORAGE_DRAFTS_KEY,
  STORAGE_HEIGHT_KEY,
  STORAGE_LAST_PROBLEM_KEY,
  STORAGE_RUNS_KEY,
};
export type { StoredRunRecord };

const ROTATE_HINT_DISMISSED_KEY = 'hldarena_rotate_hint_dismissed_v1';

interface ArenaWorkspaceProps {
  problem: PublicProblemSpec;
  prevProblem?: PublicProblemNavLink | null;
  nextProblem?: PublicProblemNavLink | null;
  relatedProblems?: PublicProblemSummary[];
}

export default function ArenaWorkspace({
  problem,
  prevProblem = null,
  nextProblem = null,
  relatedProblems = [],
}: ArenaWorkspaceProps) {
  const {
    user,
    profile,
    authLoading,
    signingIn,
    isDevDummyAvailable,
    isDummyUser,
    signInWithGoogle,
    signInAsDummyUser,
    recordDummySubmission,
    syncPreferences,
  } = useAuth();
  const isSubmitLocked = !user;

  const [isRunningSample, setIsRunningSample] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [dismissedGuestHint, setDismissedGuestHint] = useState<boolean>(false);
  const [latestTestSuite, setLatestTestSuite] =
    useState<TestSuiteSummary | null>(null);
  const [customTestConfig, setCustomTestConfig] = useState<CustomTestCaseInput>(
    () => ({
      readRps: problem.sampleTestCases[1]?.inputSummary.readRps ?? 20_000,
      writeRps: problem.sampleTestCases[1]?.inputSummary.writeRps ?? 2_000,
      skewLevel: 'moderate',
      faultKind: 'none',
    })
  );
  const [includeCustomInRun, setIncludeCustomInRun] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  // A signed-in user's official result that the server judged but did not record,
  // with the server's short reason code when it sent one
  const [unsavedResult, setUnsavedResult] = useState<{
    reason: string | null;
  } | null>(null);
  // Hidden until we know the visitor has not dismissed it before (avoids a flash)
  const [rotateHintDismissed, setRotateHintDismissed] = useState<boolean>(true);
  const [dismissedAlignmentBanner, setDismissedAlignmentBanner] =
    useState<boolean>(false);
  const [leftPaneTab, setLeftPaneTab] = useState<
    'description' | 'solutions' | 'runs'
  >('description');
  const [solutionCount, setSolutionCount] = useState<number>(0);
  const [openSolutionComposerCounter, setOpenSolutionComposerCounter] =
    useState<number>(0);

  const resetPlaybackRef = useRef<() => void>(() => {});

  const workspace = useCloudWorkspaceSync({
    problem,
    user,
    profile,
    isDummyUser,
    recordDummySubmission,
    onProblemReset: () => {
      resetPlaybackRef.current();
      setLatestTestSuite(null);
      setUnsavedResult(null);
      setDismissedAlignmentBanner(false);
      setLeftPaneTab('description');
      setCustomTestConfig({
        readRps: problem.sampleTestCases[1]?.inputSummary.readRps ?? 20_000,
        writeRps: problem.sampleTestCases[1]?.inputSummary.writeRps ?? 2_000,
        skewLevel: 'moderate',
        faultKind: 'none',
      });
      setIncludeCustomInRun(false);
    },
  });

  const playback = useSimulationPlayback({
    problemId: problem.id,
    problemSubmissions: workspace.problemSubmissions,
    setSubmissionsByProblem: workspace.setSubmissionsByProblem,
    currentDraft: workspace.currentDraft,
    setDraftsByProblem: workspace.setDraftsByProblem,
    setStashedDraftByProblem: workspace.setStashedDraftByProblem,
    canvasHeight: workspace.canvasHeight,
    hasCustomHeight: workspace.hasCustomHeight,
    setCanvasHeight: workspace.setCanvasHeight,
    setLatestTestSuite,
    setErrorBanner,
  });
  resetPlaybackRef.current = playback.resetPlaybackState;

  useEffect(() => {
    try {
      setRotateHintDismissed(
        window.localStorage.getItem(ROTATE_HINT_DISMISSED_KEY) === '1'
      );
    } catch {
      setRotateHintDismissed(false);
    }
  }, []);

  function handleDismissRotateHint() {
    setRotateHintDismissed(true);
    try {
      window.localStorage.setItem(ROTATE_HINT_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage errors: the hint simply returns on the next visit
    }
  }

  function handleRestoreStashedDraft() {
    const stashed = workspace.stashedDraftByProblem[problem.id];
    if (!stashed) return;
    workspace.setDraftsByProblem((prev) => ({
      ...prev,
      [problem.id]: cloneSnapshot(stashed),
    }));
    workspace.setStashedDraftByProblem((prev) => ({
      ...prev,
      [problem.id]: null,
    }));
    playback.setReplayEnabled(false);
    playback.setIsPlaying(false);
  }

  async function handleRunSampleTests(forceIncludeCustom = false) {
    setErrorBanner(null);
    setDismissedAlignmentBanner(false);
    setIsRunningSample(true);
    try {
      const shouldIncludeCustom = forceIncludeCustom || includeCustomInRun;
      const res = await runSampleTestsViaApi({
        problemId: problem.id,
        snapshot: {
          nodes: workspace.currentDraft.nodes,
          edges: workspace.currentDraft.edges,
          boundaries: workspace.currentDraft.boundaries,
          writeupMarkdown: workspace.currentDraft.writeupMarkdown,
        },
        customTestCase: shouldIncludeCustom ? customTestConfig : null,
      });
      setLatestTestSuite(res.testSuite);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Sample test run failed'
      );
    } finally {
      setIsRunningSample(false);
    }
  }

  async function handleSubmitDesign() {
    if (!user) {
      void signInWithGoogle();
      return;
    }
    setErrorBanner(null);
    setUnsavedResult(null);
    setIsSubmitting(true);
    try {
      const prevRunsCount = Math.max(
        workspace.problemSubmissions.length,
        profile?.progressSummary?.[problem.id]?.runsCount ?? 0
      );
      const nextNum = prevRunsCount + 1;

      const evaluation = await evaluateDesignViaApi({
        problemId: problem.id,
        snapshot: {
          nodes: workspace.currentDraft.nodes,
          edges: workspace.currentDraft.edges,
          boundaries: workspace.currentDraft.boundaries,
          writeupMarkdown: workspace.currentDraft.writeupMarkdown,
        },
        submissionName: `Run #${nextNum}`,
      });

      if (evaluation.testSuite) {
        setLatestTestSuite(evaluation.testSuite);
      }
      setUnsavedResult(
        wasResultLeftUnsaved({
          hasUser: Boolean(user),
          isDummyUser,
          evaluation,
        })
          ? { reason: evaluation.integrity?.persistFailureReason ?? null }
          : null
      );

      const prevSubs = workspace.problemSubmissions;
      workspace.recordEvaluatedSubmission(evaluation);
      playback.activateSubmittedEvaluation(evaluation, prevSubs);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Submission error');
    } finally {
      setIsSubmitting(false);
    }
  }

  const draftStats = useMemo(
    () =>
      computeDraftWriteupStats(
        workspace.currentDraft.nodes,
        workspace.currentDraft.writeupMarkdown,
        problem.functionalRequirements
      ),
    [
      workspace.currentDraft.nodes,
      workspace.currentDraft.writeupMarkdown,
      problem.functionalRequirements,
    ]
  );

  const localHasAc = useMemo(
    () =>
      Boolean(user) &&
      (playback.activeResult?.score.verdict === 'AC' ||
        workspace.problemSubmissions.some((s) => s.score.verdict === 'AC')),
    [user, playback.activeResult, workspace.problemSubmissions]
  );

  const latestAcPayload = useMemo((): {
    snapshot: SubmissionSnapshot;
    metrics: SolutionMetricsBadge;
  } | null => {
    if (!user) return null;
    const candidates = [
      ...(playback.activeResult ? [playback.activeResult] : []),
      ...workspace.problemSubmissions,
    ].filter((r) => r.score.verdict === 'AC');
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score.totalScore - a.score.totalScore);
    const best = candidates[0];
    return {
      snapshot: best.snapshot,
      metrics: {
        p99Ms: best.score.metrics.weightedP99Ms,
        availabilityPct: best.score.metrics.overallAvailabilityPct,
        monthlyCostUsd: best.score.metrics.monthlyCostUsd,
        totalScore: best.score.totalScore,
        maxScore: problem.maxPoints,
        verdict: 'AC',
      },
    };
  }, [user, playback.activeResult, problem.maxPoints, workspace.problemSubmissions]);

  return (
    <div className="min-h-screen flex flex-col bg-app text-ink">
      <SiteHeader
        activeNav="workspace"
        currentProblem={problem}
        prevProblem={prevProblem}
        nextProblem={nextProblem}
        rightActions={
          <div className="flex items-center gap-2.5">
            {!isSubmitLocked && playback.replayEnabled && playback.activeResult && (
              <button
                type="button"
                onClick={() => {
                  playback.setReplayEnabled(false);
                  playback.setIsPlaying(false);
                }}
                className="px-3 py-1.5 rounded border border-hairline hover:border-strong text-sm text-secondary hover:text-ink transition-colors cursor-pointer"
              >
                <span className="sm:hidden">Exit</span>
                <span className="hidden sm:inline">Exit Replay</span>
              </button>
            )}

            <button
              type="button"
              id="run-sample-btn"
              disabled={isRunningSample || isSubmitting}
              title="Run Sample Test Cases (free guest sandbox — does not record an official submission)"
              onClick={() => void handleRunSampleTests(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded border border-emerald-500/45 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-medium text-sm text-emerald-800 dark:text-emerald-300 transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{isRunningSample ? 'Running...' : 'Run'}</span>
            </button>

            {/* Guests cannot submit: the button is disabled and grey, and hovering
                it says why. (The hover wrapper is needed because a disabled button
                shows no tooltip of its own in every browser.) */}
            <span className="relative group inline-flex">
              <button
                type="button"
                id="submit-hld-btn"
                disabled={
                  isSubmitLocked || isSubmitting || isRunningSample || authLoading
                }
                aria-describedby={
                  isSubmitLocked && !authLoading ? 'submit-signin-hint' : undefined
                }
                title={
                  isSubmitLocked
                    ? undefined
                    : 'Submit against all 7 judge test cases'
                }
                onClick={handleSubmitDesign}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded font-medium text-sm transition-colors ${
                  isSubmitLocked && !authLoading
                    ? 'bg-subtle text-muted border border-hairline cursor-not-allowed'
                    : 'bg-accent hover:bg-accent-hover text-white disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer'
                }`}
              >
                {isSubmitLocked && !authLoading && (
                  <Lock className="w-3.5 h-3.5" />
                )}
                <span>{isSubmitting ? 'Judging...' : 'Submit'}</span>
              </button>
              {isSubmitLocked && !authLoading && (
                <span
                  id="submit-signin-hint"
                  role="tooltip"
                  className="pointer-events-none absolute right-0 top-full z-40 mt-1.5 hidden group-hover:block whitespace-nowrap rounded bg-ink px-2.5 py-1 text-xs font-medium text-surface shadow-sm"
                >
                  Sign in to submit
                </span>
              )}
            </span>
          </div>
        }
      />

      {isSubmitLocked && !authLoading && !dismissedGuestHint && (
        <div
          id="guest-sandbox-banner"
          className="px-6 py-2 bg-subtle/65 border-b border-hairline flex items-center justify-between gap-3 flex-wrap text-xs text-secondary"
        >
          <div>
            <strong className="text-ink font-semibold">
              Guest Sandbox Active:
            </strong>{' '}
            Draw your architecture, write your spec, and click{' '}
            <strong className="text-emerald-700 dark:text-emerald-400">
              Run
            </strong>{' '}
            freely with zero login. Sign in when ready to{' '}
            <strong className="text-ink">Submit</strong> against all 7 chaos waves &amp; earn Architect Rating (your guest draft carries over).
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {process.env.NODE_ENV === 'development' && isDevDummyAvailable && (
              <button
                type="button"
                onClick={signInAsDummyUser}
                className="px-2.5 py-1 rounded border border-dashed border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20 font-medium text-amber-800 dark:text-amber-300 cursor-pointer"
              >
                Use Dummy User
              </button>
            )}
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="px-2.5 py-1 rounded bg-ink text-surface hover:opacity-90 font-medium cursor-pointer"
            >
              Sign in to Save &amp; Submit
            </button>
            <button
              type="button"
              aria-label="Dismiss guest sandbox hint"
              onClick={() => setDismissedGuestHint(true)}
              className="p-1 rounded hover:bg-subtle text-muted hover:text-ink cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {errorBanner && (
        <div className="px-6 py-2.5 bg-red-500/10 border-b border-red-500/30 text-sm text-red-700 dark:text-red-300">
          {errorBanner}
        </div>
      )}

      {unsavedResult && (
        <div
          id="result-not-saved-banner"
          role="alert"
          className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/40 flex items-start justify-between gap-3 text-sm text-amber-900 dark:text-amber-200"
        >
          <div className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span>
              <strong className="font-semibold">
                This result was not saved.
              </strong>{' '}
              It will not count toward your profile, rating or the
              leaderboard. Your design is kept, so you can submit it again
              later.
              {unsavedResult.reason && (
                <span
                  id="result-not-saved-reason"
                  className="ml-1.5 font-mono text-xs opacity-80"
                >
                  (ref: {unsavedResult.reason})
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss unsaved result warning"
            onClick={() => setUnsavedResult(null)}
            className="p-1 rounded hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {!dismissedAlignmentBanner &&
        latestTestSuite?.mode === 'sample_run' &&
        (latestTestSuite.alignmentFlags?.length ?? 0) > 0 && (
          <div className="px-6 py-2.5 bg-amber-500/12 border-b border-amber-500/40 flex items-center justify-between gap-4 flex-wrap text-xs sm:text-sm text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="font-semibold shrink-0">
                Write-up &harr; Diagram Difference (
                {latestTestSuite.alignmentFlags!.length}):
              </span>
              <span className="truncate text-ink">
                {latestTestSuite.alignmentFlags![0].title}
                {latestTestSuite.alignmentFlags!.length > 1
                  ? ` (+${latestTestSuite.alignmentFlags!.length - 1} more)`
                  : ''}
              </span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  document
                    .getElementById('test-cases-console')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
                className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 font-mono text-xs font-semibold text-amber-950 dark:text-amber-200 transition-colors cursor-pointer"
              >
                View in Test Result &darr;
              </button>
              <button
                type="button"
                aria-label="Dismiss alignment flag banner"
                onClick={() => setDismissedAlignmentBanner(true)}
                className="p-1 rounded hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

      <main className="w-full border-b border-hairline grid grid-cols-1 xl:grid-cols-12 items-stretch">
        <ArenaLeftSidebar
          problem={problem}
          canvasHeight={workspace.canvasHeight}
          leftPaneTab={leftPaneTab}
          onChangeTab={setLeftPaneTab}
          isLocked={isSubmitLocked}
          authLoading={authLoading}
          onSignIn={() => void signInWithGoogle()}
          problemSubmissions={workspace.problemSubmissions}
          activeSubmissionId={playback.activeSubmissionId}
          currentDraft={workspace.currentDraft}
          hydratingRunId={playback.hydratingRunId}
          stashedDraft={workspace.stashedDraftByProblem[problem.id] ?? null}
          onRestoreStashedDraft={handleRestoreStashedDraft}
          onSelectRun={(sub) => void playback.handleSelectRun(sub)}
          localHasAc={localHasAc}
          latestAcPayload={latestAcPayload}
          solutionCount={solutionCount}
          onSolutionCountChange={setSolutionCount}
          openSolutionComposerCounter={openSolutionComposerCounter}
          relatedProblems={relatedProblems}
        />

        <section className="xl:col-span-6 flex flex-col bg-canvas">
          {/* Phones held upright only: the whiteboard is 2x wider sideways */}
          {!rotateHintDismissed && (
            <div
              id="rotate-device-hint"
              className="hidden max-sm:portrait:flex items-center justify-between gap-3 px-4 py-2 border-b border-hairline bg-app text-xs text-secondary"
            >
              <span className="inline-flex items-center gap-2">
                <Smartphone
                  className="w-4 h-4 shrink-0 -rotate-90 text-accent"
                  aria-hidden="true"
                />
                <span>
                  Turn your phone sideways for a wider whiteboard.
                </span>
              </span>
              <button
                type="button"
                aria-label="Dismiss rotate hint"
                onClick={handleDismissRotateHint}
                className="p-1 rounded text-muted hover:text-ink cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <WhiteboardCanvas
            nodes={workspace.currentDraft.nodes}
            edges={workspace.currentDraft.edges}
            boundaries={workspace.currentDraft.boundaries}
            disabled={false}
            authLoading={authLoading}
            signingIn={signingIn}
            onSignIn={() => void signInWithGoogle()}
            onSignInDummy={
              process.env.NODE_ENV === 'development' && isDevDummyAvailable
                ? signInAsDummyUser
                : undefined
            }
            compiledNodes={
              !isSubmitLocked && playback.replayEnabled && playback.activeResult
                ? playback.activeResult.ir.nodes
                : undefined
            }
            compiledEdges={
              !isSubmitLocked && playback.replayEnabled && playback.activeResult
                ? playback.activeResult.ir.edges
                : undefined
            }
            resizable={true}
            canvasHeight={workspace.canvasHeight}
            onChangeCanvasHeight={(h) => {
              workspace.setHasCustomHeight(true);
              workspace.setCanvasHeight(h);
              void syncPreferences({ canvasHeight: h });
            }}
            onChangeNodes={(nodes) => {
              workspace.updateDraft({ nodes });
            }}
            onChangeEdges={(edges) => {
              workspace.updateDraft({ edges });
            }}
            onChangeBoundaries={(boundaries) => {
              workspace.updateDraft({ boundaries });
            }}
            activeFrame={isSubmitLocked ? null : playback.activeFrame}
            isPlaying={!isSubmitLocked && playback.isPlaying}
          />

          {!isSubmitLocked &&
            playback.activeResult &&
            playback.activeResult.frames.length > 0 && (
              <ReplayScrubberBar
                activeResult={playback.activeResult}
                activeFrame={playback.activeFrame}
                waves={problem.waves}
                replayEnabled={playback.replayEnabled}
                isPlaying={playback.isPlaying}
                playbackSpeed={playback.playbackSpeed}
                currentTick={playback.currentTick}
                onTogglePlay={() => {
                  if (!playback.replayEnabled) {
                    playback.setReplayEnabled(true);
                    playback.setIsPlaying(true);
                    return;
                  }
                  if (
                    playback.currentTick >=
                    playback.activeResult!.frames.length - 1
                  ) {
                    playback.setCurrentTick(0);
                    playback.setIsPlaying(true);
                  } else {
                    playback.setIsPlaying(!playback.isPlaying);
                  }
                }}
                onChangeSpeed={playback.setPlaybackSpeed}
                onSeekTick={(tick) => {
                  playback.setReplayEnabled(true);
                  playback.setCurrentTick(tick);
                }}
              />
            )}
        </section>

        <DesignWriteupPane
          problem={problem}
          heightPx={Math.max(480, workspace.canvasHeight + 58)}
          isLocked={false}
          authLoading={authLoading}
          signingIn={signingIn}
          isDevDummyAvailable={isDevDummyAvailable}
          onSignInWithGoogle={() => void signInWithGoogle()}
          onSignInAsDummyUser={signInAsDummyUser}
          writeupMarkdown={workspace.currentDraft.writeupMarkdown}
          onChangeWriteup={(next) =>
            workspace.updateDraft({ writeupMarkdown: next })
          }
          draftStats={draftStats}
          nodesCount={workspace.currentDraft.nodes.length}
          edgesCount={workspace.currentDraft.edges.length}
          cloudSaveState={workspace.cloudSaveState}
          hasUser={Boolean(user)}
          activeMatchedSubmissionName={
            playback.activeResult?.snapshot &&
            snapshotsEqual(
              playback.activeResult.snapshot,
              workspace.currentDraft
            )
              ? playback.activeResult.submissionName
              : null
          }
          hasEditedSinceSubmission={workspace.problemSubmissions.length > 0}
        />
      </main>

      <TestCasesPanel
        problem={problem}
        disabled={false}
        isRunningSample={isRunningSample}
        isSubmitting={isSubmitting}
        testSuite={latestTestSuite}
        customConfig={customTestConfig}
        includeCustomInRun={includeCustomInRun}
        onChangeCustomConfig={setCustomTestConfig}
        onChangeIncludeCustom={setIncludeCustomInRun}
        onRunTests={(forceCustom) =>
          void handleRunSampleTests(Boolean(forceCustom))
        }
      />

      {!isSubmitLocked && playback.activeResult && (
        <section className="px-6 py-6 border-t border-hairline space-y-5">
          <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b border-hairline">
            <span className="text-base font-semibold text-ink">
              Evaluation Results · {playback.activeResult.submissionName}
            </span>

            <div className="flex items-center gap-3 text-sm flex-wrap">
              {playback.activeResult.score.verdict === 'AC' && (
                <button
                  type="button"
                  onClick={() => {
                    setLeftPaneTab('solutions');
                    setOpenSolutionComposerCounter((c) => c + 1);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-emerald-600 text-white hover:opacity-90 font-medium transition-opacity cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share AC Solution</span>
                </button>
              )}

              <label htmlFor="compare-select" className="text-muted">
                Compare:
              </label>
              <select
                id="compare-select"
                value={playback.compareSelection}
                onChange={(e) => playback.setCompareSelection(e.target.value)}
                className="bg-surface border border-hairline rounded px-2.5 py-1.5 text-sm text-ink outline-none focus:border-strong"
              >
                <option value="benchmark">Reference Benchmark</option>
                {workspace.problemSubmissions
                  .filter(
                    (s) =>
                      s.submissionId !== playback.activeResult!.submissionId
                  )
                  .map((s) => (
                    <option key={s.submissionId} value={s.submissionId}>
                      {s.submissionName} ({s.score.totalScore} ·{' '}
                      {s.score.verdict})
                    </option>
                  ))}
                <option value="none">None</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  playback.setActiveSubmissionId(null);
                  playback.setReplayEnabled(false);
                  playback.setIsPlaying(false);
                }}
                className="px-3 py-1.5 rounded border border-hairline hover:border-strong text-secondary hover:text-ink transition-colors cursor-pointer"
              >
                Hide Results
              </button>
            </div>
          </div>

          {playback.activeResult.frames.length > 0 && (
            <TelemetryCharts
              frames={playback.activeResult.frames}
              currentTick={playback.currentTick}
              onSeekTick={(tick) => {
                playback.setReplayEnabled(true);
                playback.setCurrentTick(tick);
              }}
              problem={problem}
              comparisonTarget={playback.comparisonTarget}
            />
          )}

          <ScorecardPanel
            result={playback.activeResult}
            problem={problem}
            comparisonTarget={playback.comparisonTarget}
          />
        </section>
      )}
    </div>
  );
}
