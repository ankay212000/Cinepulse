'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, BookOpen, History, Lock } from 'lucide-react';
import ProblemSolutionsTab from '@/components/ProblemSolutionsTab';
import { getCompaniesForProblem } from '@/lib/hldSheetsAndCompanies';
import type {
  DifficultyLevel,
  EvaluationResult,
  PublicProblemSpec,
  PublicProblemSummary,
  SolutionMetricsBadge,
  SubmissionSnapshot,
} from '@/types';
import { snapshotsEqual } from './useCloudWorkspaceSync';

export function difficultyTextClass(level: DifficultyLevel): string {
  switch (level) {
    case 'Easy':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'Medium':
      return 'text-amber-700 dark:text-amber-400';
    case 'Hard':
      return 'text-orange-700 dark:text-orange-400';
    case 'Expert':
      return 'text-red-700 dark:text-red-400 font-semibold';
  }
}

export function difficultyBadgeClass(level: DifficultyLevel): string {
  switch (level) {
    case 'Easy':
      return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
    case 'Medium':
      return 'bg-amber-500/12 text-amber-800 dark:text-amber-300 border-amber-500/30';
    case 'Hard':
      return 'bg-orange-500/12 text-orange-800 dark:text-orange-300 border-orange-500/30';
    case 'Expert':
      return 'bg-red-500/12 text-red-700 dark:text-red-300 border-red-500/30 font-semibold';
  }
}

export interface ArenaLeftSidebarProps {
  problem: PublicProblemSpec;
  canvasHeight: number;
  leftPaneTab: 'description' | 'solutions' | 'runs';
  onChangeTab: (tab: 'description' | 'solutions' | 'runs') => void;
  isLocked: boolean;
  authLoading: boolean;
  onSignIn: () => void;
  problemSubmissions: EvaluationResult[];
  activeSubmissionId: string | null;
  currentDraft: SubmissionSnapshot;
  hydratingRunId: string | null;
  stashedDraft: SubmissionSnapshot | null;
  onRestoreStashedDraft: () => void;
  onSelectRun: (sub: EvaluationResult) => void;
  localHasAc: boolean;
  latestAcPayload: {
    snapshot: SubmissionSnapshot;
    metrics: SolutionMetricsBadge;
  } | null;
  solutionCount: number;
  onSolutionCountChange: (count: number) => void;
  openSolutionComposerCounter: number;
  relatedProblems?: PublicProblemSummary[];
}

export default function ArenaLeftSidebar({
  problem,
  canvasHeight,
  leftPaneTab,
  onChangeTab,
  isLocked,
  authLoading,
  onSignIn,
  problemSubmissions,
  activeSubmissionId,
  currentDraft,
  hydratingRunId,
  stashedDraft,
  onRestoreStashedDraft,
  onSelectRun,
  localHasAc,
  latestAcPayload,
  solutionCount,
  onSolutionCountChange,
  openSolutionComposerCounter,
  relatedProblems = [],
}: ArenaLeftSidebarProps) {
  // Curated list plus a category match, not sourced interview reports, so the UI
  // labels these as relevant practice rather than "asked at".
  const relatedCompanies = getCompaniesForProblem(problem);
  return (
    <section
      style={{ maxHeight: `${Math.max(540, canvasHeight + 58)}px` }}
      className="xl:col-span-3 bg-app border-b xl:border-b-0 xl:border-r border-hairline flex flex-col overflow-hidden"
    >
      <div className="h-12 px-5 border-b border-hairline flex items-center gap-6 shrink-0 text-sm overflow-x-auto">
        <button
          type="button"
          id="description-tab-btn"
          onClick={() => onChangeTab('description')}
          className={`relative h-full inline-flex items-center transition-colors cursor-pointer shrink-0 ${
            leftPaneTab === 'description'
              ? 'text-ink font-semibold after:content-[""] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-ink'
              : 'text-secondary hover:text-ink'
          }`}
        >
          Description
        </button>

        <button
          type="button"
          onClick={() => onChangeTab('solutions')}
          className={`relative h-full inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
            leftPaneTab === 'solutions'
              ? 'text-ink font-semibold after:content-[""] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-ink'
              : 'text-secondary hover:text-ink'
          }`}
        >
          <span>Solutions</span>
          {solutionCount > 0 && (
            <span className="font-mono text-xs text-muted tabular-nums">
              ({solutionCount})
            </span>
          )}
        </button>

        <button
          type="button"
          id="previous-runs-tab-btn"
          onClick={() => onChangeTab('runs')}
          className={`relative h-full inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
            leftPaneTab === 'runs'
              ? 'text-ink font-semibold after:content-[""] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-ink'
              : 'text-secondary hover:text-ink'
          }`}
        >
          <History className="w-3.5 h-3.5 shrink-0" />
          <span>Previous Runs</span>
          {!isLocked && problemSubmissions.length > 0 && (
            <span className="font-mono text-xs text-accent font-semibold tabular-nums">
              {problemSubmissions.length}
            </span>
          )}
        </button>
      </div>

      <div className="p-5 flex-1 overflow-y-auto">
        <div className={leftPaneTab === 'description' ? 'space-y-5' : 'hidden'}>
          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-accent">{problem.code}</span>
                <span className="text-strong">·</span>
                <span className="text-secondary font-sans">
                  {problem.category}
                </span>
              </div>
              <span
                className={`font-sans font-semibold text-xs ${difficultyTextClass(
                  problem.difficulty
                )}`}
              >
                {problem.difficulty} · {problem.maxPoints.toLocaleString()} pts
              </span>
            </div>
            <h1 className="text-lg sm:text-xl font-semibold text-ink mt-2 leading-snug tracking-tight">
              {problem.title}
            </h1>
            <p className="text-sm text-secondary mt-2 leading-relaxed">
              {problem.summary}
            </p>
          </div>

          <div className="grid grid-cols-3 divide-x divide-hairline border-y border-hairline py-3">
            <div className="pr-3">
              <div className="text-xs text-muted">Max p99</div>
              <div className="text-sm font-mono font-semibold tabular-nums text-ink mt-0.5">
                &le; {problem.slo.maxP99Ms} ms
              </div>
            </div>
            <div className="px-3">
              <div className="text-xs text-muted">Availability</div>
              <div className="text-sm font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
                &ge; {problem.slo.minAvailabilityPct}%
              </div>
            </div>
            <div className="pl-3">
              <div className="text-xs text-muted">Budget</div>
              <div className="text-sm font-mono font-semibold tabular-nums text-ink mt-0.5">
                &le; ${problem.monthlyBudgetUsd.toLocaleString()}
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-ink mb-2">
              Functional Requirements
            </h2>
            <ul className="space-y-2.5 text-sm text-secondary">
              {problem.functionalRequirements.map((req, i) => (
                <li key={i} className="leading-relaxed flex items-baseline gap-2">
                  <span className="shrink-0 font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded bg-accent-soft border border-accent/25 text-accent">
                    FR-{i + 1}
                  </span>
                  <span>{req}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-4 border-t border-hairline">
            <h2 className="text-sm font-semibold text-ink mb-2">
              Workload Profile
            </h2>
            <div className="divide-y divide-hairline">
              {problem.scaleSpecs.map((s) => (
                <div
                  key={s.label}
                  className="py-2 flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-muted shrink-0">{s.label}</span>
                  <span className="text-ink text-right font-mono text-xs">
                    {s.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-hairline">
            <h2 className="text-sm font-semibold text-ink mb-1.5">
              Consistency Model
            </h2>
            <p className="text-sm text-secondary leading-relaxed border-l-2 border-accent pl-3">
              {problem.consistencyDescription}
            </p>
          </div>

          {relatedCompanies.length > 0 && (
            <div className="pt-4 border-t border-hairline space-y-2">
              <h2 className="text-xs font-mono uppercase tracking-wider text-muted">
                Relevant practice for
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {relatedCompanies.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/companies/${c.slug}`}
                    className="px-2 py-0.5 rounded border border-hairline bg-surface hover:border-strong text-xs text-secondary hover:text-ink transition-colors"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {relatedProblems.length > 0 && (
            <div className="pt-4 border-t border-hairline space-y-2">
              <h2 className="text-xs font-mono uppercase tracking-wider text-muted">
                Related System Design Questions
              </h2>
              <ul className="space-y-1.5 text-xs">
                {relatedProblems.map((rel) => (
                  <li key={rel.id}>
                    <Link
                      href={`/problems/${rel.id}`}
                      className="flex items-center justify-between gap-2 py-1 text-secondary hover:text-accent transition-colors"
                    >
                      <span className="truncate">
                        <span className="font-mono text-muted mr-1.5">
                          {rel.code}
                        </span>
                        {rel.title}
                      </span>
                      <span
                        className={`shrink-0 font-medium ${difficultyTextClass(
                          rel.difficulty
                        )}`}
                      >
                        {rel.difficulty}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className={leftPaneTab === 'solutions' ? 'block' : 'hidden'}>
          <ProblemSolutionsTab
            problem={problem}
            localRunsCount={problemSubmissions.length}
            localHasAc={localHasAc}
            latestAcPayload={latestAcPayload}
            externalOpenComposerCounter={openSolutionComposerCounter}
            onSolutionCountChange={onSolutionCountChange}
          />
        </div>

        <div className={leftPaneTab === 'runs' ? 'space-y-3' : 'hidden'}>
          {isLocked && !authLoading ? (
            <div className="py-8 text-center space-y-2.5 border-y border-hairline">
              <Lock className="w-4 h-4 text-muted mx-auto" />
              <div className="text-sm font-semibold text-ink">
                Sign in to view &amp; record runs
              </div>
              <p className="text-xs text-secondary leading-relaxed">
                Your submitted designs, scores, and 60s simulation replays are
                stored per question here.
              </p>
              <button
                type="button"
                onClick={onSignIn}
                className="px-4 py-1.5 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium cursor-pointer"
              >
                Sign in
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 text-sm pb-2 border-b border-hairline">
                <span className="font-semibold text-ink">
                  Submission History ({problemSubmissions.length})
                </span>
                <span className="text-xs font-mono text-muted">
                  Select to replay
                </span>
              </div>

              {stashedDraft && (
                <button
                  type="button"
                  onClick={onRestoreStashedDraft}
                  className="w-full text-left px-3 py-2 rounded border border-dashed border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/15 transition-colors cursor-pointer text-sm text-amber-800 dark:text-amber-300 font-medium"
                >
                  Restore unsaved draft
                </button>
              )}

              {problemSubmissions.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <History className="w-5 h-5 text-muted mx-auto" />
                  <div className="text-sm font-semibold text-ink">
                    No submissions yet
                  </div>
                  <p className="text-xs text-secondary leading-relaxed">
                    Click <strong className="text-ink">Submit</strong> in the top
                    bar to evaluate against all 7 judge cases and save each run
                    here.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-hairline">
                  {problemSubmissions.map((sub) => {
                    const isCurrent =
                      sub.submissionId === activeSubmissionId &&
                      sub.snapshot &&
                      snapshotsEqual(sub.snapshot, currentDraft);
                    const isAc = sub.score.verdict === 'AC';
                    const isWarn =
                      sub.score.verdict === 'TLE_LATENCY_SLO' ||
                      sub.score.verdict === 'MLE_OVER_BUDGET' ||
                      sub.score.verdict === 'WA_FUNCTIONAL';
                    const isHydrating = hydratingRunId === sub.submissionId;
                    const hasMetrics =
                      sub.frames.length > 0 ||
                      sub.score.metrics.weightedP99Ms > 0 ||
                      sub.score.metrics.monthlyCostUsd > 0;
                    const submittedLabel = (() => {
                      const d = new Date(sub.submittedAtIso);
                      if (Number.isNaN(d.getTime())) return '';
                      return d.toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                    })();

                    return (
                      <button
                        key={sub.submissionId}
                        type="button"
                        disabled={isHydrating}
                        onClick={() => {
                          void onSelectRun(sub);
                        }}
                        className={`w-full text-left py-3 px-2 rounded transition-colors cursor-pointer ${
                          isCurrent ? 'bg-subtle' : 'hover:bg-subtle/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-ink truncate">
                            {sub.submissionName}
                          </span>
                          <span
                            className={`text-[11px] font-mono font-semibold shrink-0 ${
                              isAc
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : isWarn
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {sub.score.verdict}
                          </span>
                        </div>

                        <div className="mt-1 flex items-center justify-between gap-2 text-xs font-mono text-muted">
                          <span>
                            {sub.score.totalScore} / {problem.maxPoints} pts
                            {hasMetrics
                              ? ` · p99 ${sub.score.metrics.weightedP99Ms}ms · $${sub.score.metrics.monthlyCostUsd}`
                              : ''}
                          </span>
                          {isHydrating ? (
                            <span className="text-accent">Loading...</span>
                          ) : isCurrent ? (
                            <span className="text-accent font-semibold">
                              Viewing
                            </span>
                          ) : (
                            <span>{submittedLabel}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Pinned Rulebook Hyperlink directly after the question — always visible without scrolling */}
      {leftPaneTab === 'description' && (
        <div className="px-5 py-2.5 border-t border-hairline bg-surface/55 shrink-0">
          <Link
            id="question-rulebook-link"
            href="/rules"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span>Rules: Costing price &amp; marks distribution</span>
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
          </Link>
        </div>
      )}
    </section>
  );
}
