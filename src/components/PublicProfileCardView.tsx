'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Share2,
  Trophy,
} from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { useAuth } from '@/components/AuthProvider';
import { difficultyTextClass } from '@/components/ArenaWorkspace';
import {
  buildLeaderboardEntryFromUserProfile,
  getDevSeedLeaderboardEntries,
} from '@/lib/devLeaderboardSeeds';
import { getRatingTier, INITIAL_RATING } from '@/lib/ratingSystem';
import { useOwnPublicLeaderboardEntry } from '@/lib/useOwnPublicLeaderboardEntry';
import type {
  DifficultyLevel,
  LeaderboardEntry,
  PublicProblemSummary,
} from '@/types';

const TIERS: DifficultyLevel[] = ['Easy', 'Medium', 'Hard', 'Expert'];

export default function PublicProfileCardView({
  uid,
  serverEntry,
  problems,
}: {
  uid: string;
  serverEntry: LeaderboardEntry | null;
  problems: PublicProblemSummary[];
}) {
  const { user, profile, isDummyUser } = useAuth();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const isOwnCard = Boolean(user && user.uid === uid);
  const ownPublicEntry = useOwnPublicLeaderboardEntry(
    isOwnCard ? uid : null,
    isOwnCard && !isDummyUser
  );

  // A share card shows only public data, so its owner sees exactly what the people
  // they share it with see. It used to be built from the owner's private profile,
  // which rendered a card for the owner while everyone else got "not found".
  const resolvedEntry = useMemo((): LeaderboardEntry | null => {
    if (
      process.env.NODE_ENV === 'development' &&
      isDummyUser &&
      isOwnCard &&
      profile
    ) {
      // Local dev test account only: it has no public document
      return buildLeaderboardEntryFromUserProfile(profile);
    }
    // Freshest public copy first: this page is cached for a few seconds. Only
    // architects with a solved problem have a public card.
    if (isOwnCard && ownPublicEntry && ownPublicEntry.acceptedCount >= 1) {
      return ownPublicEntry;
    }
    if (serverEntry) return serverEntry;
    if (process.env.NODE_ENV === 'development') {
      return (
        getDevSeedLeaderboardEntries().find((s) => s.uid === uid) ?? null
      );
    }
    return null;
  }, [uid, serverEntry, isOwnCard, isDummyUser, profile, ownPublicEntry]);

  const problemById = useMemo(
    () => new Map(problems.map((p) => [p.id, p])),
    [problems]
  );

  const solvedProblems = useMemo(() => {
    if (!resolvedEntry?.problemScores) return [];
    const out: Array<{ problem: PublicProblemSummary; score: number }> = [];
    for (const [pid, meta] of Object.entries(resolvedEntry.problemScores)) {
      if (!meta.ac) continue;
      const prob = problemById.get(pid);
      if (prob) {
        out.push({ problem: prob, score: meta.score });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }, [resolvedEntry, problemById]);

  const countsByTier = useMemo(() => {
    const counts: Record<DifficultyLevel, { solved: number; total: number }> = {
      Easy: { solved: 0, total: 0 },
      Medium: { solved: 0, total: 0 },
      Hard: { solved: 0, total: 0 },
      Expert: { solved: 0, total: 0 },
    };
    for (const p of problems) {
      counts[p.difficulty].total += 1;
    }
    for (const item of solvedProblems) {
      counts[item.problem.difficulty].solved += 1;
    }
    return counts;
  }, [problems, solvedProblems]);

  function getPublicProfileUrl(): string {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/u/${encodeURIComponent(uid)}`;
    }
    return `https://hldarena.vercel.app/u/${encodeURIComponent(uid)}`;
  }

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(getPublicProfileUrl());
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }

  const ratingVal = resolvedEntry?.rating ?? INITIAL_RATING;
  const tier = getRatingTier(ratingVal);

  return (
    <div className="min-h-screen flex flex-col bg-app text-ink">
      <SiteHeader activeNav="leaderboard" />

      <main className="flex-1 w-full max-w-4xl mx-auto px-6 sm:px-10 py-8 sm:py-10 space-y-6">
        <div>
          <Link
            href="/leaderboard"
            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted hover:text-ink transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Global Leaderboard</span>
          </Link>
        </div>

        {!resolvedEntry ? (
          <div className="p-10 rounded border border-hairline bg-surface text-center space-y-2">
            <h1 className="text-base font-semibold text-ink">
              {isOwnCard
                ? 'Your card is not public yet'
                : 'Public Architect Card Not Found'}
            </h1>
            <p className="text-xs text-secondary max-w-md mx-auto">
              {isOwnCard
                ? 'It appears here, and on the leaderboard, once you have solved one problem with an official Submit (an Accepted verdict).'
                : "This architect hasn't solved a ranked problem yet, or the profile link is invalid."}
            </p>
          </div>
        ) : (
          <div
            id="public-architect-dossier"
            className="space-y-6"
          >
            {/* Shareable Architect Hero Card */}
            <section className="rounded-md border border-strong bg-surface p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-hairline pb-6">
                <div className="flex items-center gap-4">
                  {resolvedEntry.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolvedEntry.photoURL}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-full object-cover border border-hairline shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-ink text-surface font-mono text-xl font-bold flex items-center justify-center shrink-0">
                      {(resolvedEntry.handle[0] || 'A').toUpperCase()}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h1 className="text-xl sm:text-2xl font-semibold text-ink">
                        {resolvedEntry.handle}
                      </h1>
                      <span
                        className={`px-2.5 py-0.5 rounded border font-mono text-xs font-semibold ${tier.badgeClass}`}
                      >
                        {tier.title}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-muted">
                      HLDArena Verified System Design Portfolio
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-strong bg-canvas hover:bg-subtle text-xs font-medium text-ink cursor-pointer transition-colors"
                  >
                    {copiedUrl ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied Link!</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="w-3.5 h-3.5 text-accent" />
                        <span>Copy Profile Link</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Key Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3.5 rounded border border-hairline bg-canvas">
                  <div className="text-xs text-muted">Architect Rating</div>
                  <div
                    className={`mt-1 text-2xl font-bold font-mono tabular-nums ${tier.textClass}`}
                  >
                    {ratingVal}
                  </div>
                </div>

                <div className="p-3.5 rounded border border-hairline bg-canvas">
                  <div className="text-xs text-muted">Accepted (AC)</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                    {resolvedEntry.acceptedCount}
                    <span className="text-xs font-normal text-muted">
                      {' '}
                      / {problems.length}
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded border border-hairline bg-canvas">
                  <div className="text-xs text-muted">Total Best Points</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-ink">
                    {resolvedEntry.totalBestScore.toLocaleString()}
                  </div>
                </div>

                <div className="p-3.5 rounded border border-hairline bg-canvas">
                  <div className="text-xs text-muted">Attempted</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-ink">
                    {resolvedEntry.attemptedCount}
                  </div>
                </div>
              </div>

              {/* Tier Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                {TIERS.map((lvl) => {
                  const item = countsByTier[lvl];
                  return (
                    <div
                      key={lvl}
                      className="px-3 py-2 rounded border border-hairline bg-canvas flex items-center justify-between text-xs font-mono"
                    >
                      <span className={difficultyTextClass(lvl)}>{lvl}</span>
                      <span className="text-ink font-semibold tabular-nums">
                        {item.solved}
                        <span className="text-muted font-normal">
                          /{item.total}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Verified Solved Systems List */}
            {solvedProblems.length > 0 && (
              <section className="rounded border border-hairline bg-surface overflow-hidden">
                <div className="px-5 py-3.5 border-b border-hairline bg-subtle/30 flex items-center justify-between">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-ink">
                    <Trophy className="w-3.5 h-3.5 text-accent" />
                    <span>
                      Verified Accepted (AC) Architectures ({solvedProblems.length})
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-hairline">
                  {solvedProblems.map(({ problem, score }) => (
                    <Link
                      key={problem.id}
                      href={`/problems/${problem.id}`}
                      className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-subtle/35 transition-colors group"
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="font-mono text-xs text-muted shrink-0">
                          {problem.code}
                        </span>
                        <span className="text-sm font-medium text-ink group-hover:text-accent truncate">
                          {problem.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 text-xs font-mono">
                        <span className={difficultyTextClass(problem.difficulty)}>
                          {problem.difficulty}
                        </span>
                        <span className="text-ink font-semibold tabular-nums">
                          {score} / {problem.maxPoints}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
