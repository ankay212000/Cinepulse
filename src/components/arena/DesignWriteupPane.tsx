'use client';

import React, { useMemo } from 'react';
import { FileText, Lock } from 'lucide-react';
import {
  buildProblemWriteupTemplate,
  buildWriteupPlaceholderHint,
} from '@/lib/writeupRulesGuide';
import type { DraftWriteupStats } from '@/lib/draftStats';
import type { PublicProblemSpec } from '@/types';

interface DesignWriteupPaneProps {
  problem: PublicProblemSpec;
  heightPx: number;
  isLocked: boolean;
  authLoading: boolean;
  signingIn: boolean;
  isDevDummyAvailable: boolean;
  onSignInWithGoogle: () => void;
  onSignInAsDummyUser: () => void;
  writeupMarkdown: string;
  onChangeWriteup: (next: string) => void;
  draftStats: DraftWriteupStats;
  nodesCount: number;
  edgesCount: number;
  cloudSaveState: 'idle' | 'saving' | 'saved' | 'offline' | 'error';
  hasUser: boolean;
  activeMatchedSubmissionName: string | null;
  hasEditedSinceSubmission: boolean;
}

export default function DesignWriteupPane({
  problem,
  heightPx,
  isLocked,
  authLoading,
  signingIn,
  isDevDummyAvailable,
  onSignInWithGoogle,
  onSignInAsDummyUser,
  writeupMarkdown,
  onChangeWriteup,
  draftStats,
  nodesCount,
  edgesCount,
  cloudSaveState,
  hasUser,
  activeMatchedSubmissionName,
  hasEditedSinceSubmission,
}: DesignWriteupPaneProps) {
  const placeholderHint = useMemo(
    () => buildWriteupPlaceholderHint(problem),
    [problem]
  );

  function handleInsertTemplate() {
    if (isLocked) return;
    const scaffold = buildProblemWriteupTemplate(problem);
    const trimmed = writeupMarkdown.trim();
    if (!trimmed) {
      onChangeWriteup(scaffold);
      return;
    }
    if (writeupMarkdown.includes('### FR-1:')) {
      return;
    }
    onChangeWriteup(`${writeupMarkdown.trimEnd()}\n\n${scaffold}`);
  }

  return (
    <section
      style={{ height: `${heightPx}px` }}
      className="xl:col-span-3 bg-app border-t xl:border-t-0 xl:border-l border-hairline flex flex-col overflow-hidden"
    >
      {/* Header Bar */}
      <div className="min-h-12 px-4 py-2 border-b border-hairline flex items-center justify-between gap-2 flex-wrap text-sm shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink whitespace-nowrap">
            {isLocked && !authLoading && (
              <Lock className="w-3.5 h-3.5 text-muted" />
            )}
            <span>Design Write-up</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs font-mono text-muted flex-wrap">
          {isLocked && !authLoading ? (
            <span>Locked</span>
          ) : (
            <>
              {hasUser && cloudSaveState === 'saving' && (
                <span className="text-amber-600 dark:text-amber-400">
                  Saving...
                </span>
              )}
              {hasUser && cloudSaveState === 'saved' && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  Saved
                </span>
              )}
              {activeMatchedSubmissionName ? (
                <span className="text-accent font-semibold">
                  {activeMatchedSubmissionName}
                </span>
              ) : hasEditedSinceSubmission ? (
                <span className="text-amber-700 dark:text-amber-400">
                  Edited
                </span>
              ) : null}

              <button
                type="button"
                id="insert-writeup-template-btn"
                disabled={isLocked}
                onClick={handleInsertTemplate}
                title="Insert FR-1..FR-N & sizing scaffold into the editor"
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-hairline hover:border-strong text-[11px] font-sans font-medium text-secondary hover:text-ink transition-colors cursor-pointer"
              >
                <FileText className="w-3 h-3 shrink-0" />
                <span>Insert FR/NFR Template</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Write-up Editor */}
      <div className="flex-1 min-h-0 flex flex-col relative">
        <textarea
          id="design-writeup-textarea"
          disabled={isLocked}
          readOnly={isLocked}
          value={isLocked ? '' : writeupMarkdown}
          onChange={(e) => {
            if (!isLocked) {
              onChangeWriteup(e.target.value);
            }
          }}
          placeholder={placeholderHint}
          className={`flex-1 min-h-[220px] xl:min-h-0 w-full bg-transparent px-5 py-4 text-xs sm:text-sm font-mono text-ink placeholder:text-muted/90 resize-none outline-none leading-relaxed ${
            isLocked
              ? 'opacity-45 grayscale cursor-not-allowed select-none'
              : ''
          }`}
        />

        {isLocked && !authLoading && (
          <div className="absolute inset-0 z-20 bg-app/80 backdrop-blur-[1.5px] flex items-center justify-center p-5 text-center select-none">
            <div className="max-w-[240px] flex flex-col items-center gap-3 p-5 rounded bg-surface border border-hairline shadow-sm">
              <div className="w-9 h-9 rounded-full bg-accent-soft flex items-center justify-center text-accent">
                <Lock className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-ink">
                  Sign in to continue
                </p>
                <p className="text-xs text-secondary leading-relaxed">
                  Sign in to document Functional Requirements, data partitioning,
                  and failover in plain English.
                </p>
              </div>
              <div className="mt-1 flex flex-col items-center gap-2 w-full">
                <button
                  type="button"
                  disabled={signingIn}
                  onClick={onSignInWithGoogle}
                  className="w-full px-3.5 py-2 rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-50 text-sm font-medium transition-colors cursor-pointer"
                >
                  {signingIn ? 'Signing in...' : 'Sign in to continue'}
                </button>
                {process.env.NODE_ENV === 'development' &&
                  isDevDummyAvailable && (
                    <button
                      type="button"
                      onClick={onSignInAsDummyUser}
                      className="w-full px-3.5 py-2 rounded border border-dashed border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-medium text-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
                    >
                      Use Dummy User (Local)
                    </button>
                  )}
              </div>
            </div>
          </div>
        )}

        {/* Live Coverage & Word Counter Footer */}
        <div
          className={`px-4 py-2.5 border-t border-hairline flex items-center justify-between gap-2 flex-wrap text-xs text-muted font-mono ${
            isLocked ? 'opacity-45 select-none' : ''
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {/* A rough keyword check done in the browser while typing. It is looser
                than the judge (one keyword counts), so it says "mentioned", shows
                no green pass state, and points to Run for the judge's verdict. */}
            {!isLocked && draftStats.totalFrCount > 0 && (
              <span
                id="writeup-fr-mentions"
                title="Rough check while you type: a requirement counts once the write-up mentions it at all. Press Run to see what the judge counts as covered."
                className={
                  draftStats.addressedFrCount > 0 &&
                  draftStats.addressedFrCount < draftStats.totalFrCount
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-muted'
                }
              >
                FRs mentioned: {draftStats.addressedFrCount}/
                {draftStats.totalFrCount}
              </span>
            )}
            {!isLocked && draftStats.totalFrCount > 0 && <span>·</span>}
            <span>
              {!isLocked && draftStats.nonClientCount > 0
                ? `${draftStats.documentedCount}/${draftStats.nonClientCount} components documented`
                : `${isLocked ? 0 : nodesCount} boxes · ${
                    isLocked ? 0 : edgesCount
                  } edges`}
            </span>
          </div>

          <span
            className={
              !isLocked && draftStats.wordCount > 0 && draftStats.wordCount < 15
                ? 'text-amber-700 dark:text-amber-400'
                : ''
            }
          >
            {isLocked ? 0 : draftStats.wordCount} words
            {!isLocked && draftStats.wordCount > 0 && draftStats.wordCount < 15
              ? ' (min 15w)'
              : ''}
          </span>
        </div>
      </div>
    </section>
  );
}
