'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Award, Search, Trophy } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { useAuth } from '@/components/AuthProvider';
import {
  buildLeaderboardEntryFromUserProfile,
  getDevSeedLeaderboardEntries,
} from '@/lib/devLeaderboardSeeds';
import { getRatingTier, INITIAL_RATING } from '@/lib/ratingSystem';
import { useOwnPublicLeaderboardEntry } from '@/lib/useOwnPublicLeaderboardEntry';
import type { LeaderboardEntry } from '@/types';

export default function LeaderboardView({
  initialEntries,
}: {
  initialEntries: LeaderboardEntry[];
}) {
  const { user, profile, isDummyUser } = useAuth();
  const ownPublicEntry = useOwnPublicLeaderboardEntry(
    user?.uid,
    Boolean(user) && !isDummyUser
  );
  const [sortBy, setSortBy] = useState<'rating' | 'score'>('rating');
  const [searchQuery, setSearchQuery] = useState('');

  const mergedEntries = useMemo(() => {
    const byUid = new Map<string, LeaderboardEntry>();
    for (const entry of initialEntries) {
      byUid.set(entry.uid, entry);
    }

    if (process.env.NODE_ENV === 'development') {
      for (const seed of getDevSeedLeaderboardEntries()) {
        if (!byUid.has(seed.uid)) {
          byUid.set(seed.uid, seed);
        }
      }
    }

    // Everyone sees the same rows. The signed-in user's own row comes only from the
    // public leaderboard: this page is cached for a few seconds, so a row recorded
    // moments ago is added from the same public document other visitors will get.
    // It used to be built from the user's private profile, which showed people a
    // row of their own even when nothing had been recorded for anyone else to see.
    if (user && ownPublicEntry) {
      byUid.set(user.uid, ownPublicEntry);
    }

    // Local dev test account only: it has no public document, so keep its row.
    if (
      process.env.NODE_ENV === 'development' &&
      isDummyUser &&
      user &&
      profile
    ) {
      const liveMine = buildLeaderboardEntryFromUserProfile(profile);
      if (liveMine.attemptedCount > 0 || byUid.has(user.uid)) {
        byUid.set(user.uid, liveMine);
      }
    }

    // Only architects who have solved at least one problem are ranked
    const list = Array.from(byUid.values()).filter(
      (entry) => entry.acceptedCount >= 1
    );
    list.sort((a, b) => {
      if (sortBy === 'rating') {
        const ra = a.rating ?? INITIAL_RATING;
        const rb = b.rating ?? INITIAL_RATING;
        if (rb !== ra) return rb - ra;
      }
      if (b.totalBestScore !== a.totalBestScore) {
        return b.totalBestScore - a.totalBestScore;
      }
      return b.acceptedCount - a.acceptedCount;
    });
    return list;
  }, [initialEntries, user, profile, isDummyUser, ownPublicEntry, sortBy]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return mergedEntries;
    return mergedEntries.filter(
      (e) =>
        e.handle.toLowerCase().includes(q) ||
        (e.rankTitle ?? '').toLowerCase().includes(q)
    );
  }, [mergedEntries, searchQuery]);

  return (
    <div className="min-h-screen flex flex-col bg-app text-ink">
      <SiteHeader activeNav="leaderboard" />

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-14 py-8 sm:py-10 space-y-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-hairline pb-6">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent font-semibold">
              <Trophy className="w-3.5 h-3.5" />
              <span>Global Competitive Standings</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">
              Architect Leaderboard
            </h1>
            <p className="text-sm sm:text-[15px] text-secondary leading-relaxed">
              Server-verified standings across all High-Level Design evaluations. Click any handle to view their shareable public Architect Dossier.
            </p>
          </div>

          {user && (
            <Link
              href={`/u/${encodeURIComponent(user.uid)}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-strong bg-surface hover:bg-subtle text-xs sm:text-sm font-medium text-ink transition-colors self-start lg:self-auto"
            >
              <Award className="w-4 h-4 text-accent" />
              <span>Open My Shareable Card</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded border border-hairline bg-surface p-1 text-xs self-start">
            <button
              type="button"
              onClick={() => setSortBy('rating')}
              className={`px-3 py-1.5 rounded font-medium cursor-pointer transition-colors ${
                sortBy === 'rating'
                  ? 'bg-ink text-surface'
                  : 'text-secondary hover:text-ink'
              }`}
            >
              Sort by Architect Rating
            </button>
            <button
              type="button"
              onClick={() => setSortBy('score')}
              className={`px-3 py-1.5 rounded font-medium cursor-pointer transition-colors ${
                sortBy === 'score'
                  ? 'bg-ink text-surface'
                  : 'text-secondary hover:text-ink'
              }`}
            >
              Sort by Total Score
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search architect or tier..."
              className="w-full bg-surface border border-hairline focus:border-strong rounded pl-8 pr-3 py-1.5 text-sm text-ink placeholder:text-muted outline-none"
            />
          </div>
        </div>

        {/* Standings Table */}
        {filtered.length === 0 ? (
          <div className="p-10 rounded border border-hairline bg-surface text-center space-y-2">
            <p className="text-sm font-medium text-ink">
              No leaderboard entries match yet.
            </p>
            <p className="text-xs text-secondary">
              Solve any problem with an official Submit (an Accepted verdict) to claim a ranked spot!
            </p>
          </div>
        ) : (
          <div className="rounded border border-hairline bg-surface overflow-x-auto">
            <table
              id="global-leaderboard-table"
              className="w-full text-sm text-left border-collapse"
            >
              <thead>
                <tr className="border-b border-hairline bg-subtle/35 text-muted font-mono text-xs uppercase tracking-wider">
                  <th className="py-3 pl-4 pr-3 w-20">Rank</th>
                  <th className="py-3 px-3">Architect</th>
                  <th className="py-3 px-3">Tier</th>
                  <th className="py-3 px-3 text-right">Rating</th>
                  <th className="py-3 px-3 text-right">Solved (AC)</th>
                  <th className="py-3 pl-3 pr-4 text-right">Total Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filtered.map((entry, idx) => {
                  const ratingVal = entry.rating ?? INITIAL_RATING;
                  const tier = getRatingTier(ratingVal);
                  const isMe = Boolean(user && user.uid === entry.uid);
                  const rank = idx + 1;

                  return (
                    <tr
                      key={entry.uid}
                      className={`transition-colors ${
                        isMe
                          ? 'bg-accent-soft hover:bg-accent-soft/80'
                          : 'hover:bg-subtle/35'
                      }`}
                    >
                      <td className="py-3.5 pl-4 pr-3 font-mono text-sm font-semibold tabular-nums">
                        {rank === 1 ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            #1 🥇
                          </span>
                        ) : rank === 2 ? (
                          <span className="text-secondary">#2 🥈</span>
                        ) : rank === 3 ? (
                          <span className="text-amber-800 dark:text-amber-500">
                            #3 🥉
                          </span>
                        ) : (
                          <span className="text-muted">#{rank}</span>
                        )}
                      </td>

                      <td className="py-3.5 px-3">
                        <Link
                          href={`/u/${encodeURIComponent(entry.uid)}`}
                          className="inline-flex items-center gap-2.5 group"
                        >
                          {entry.photoURL ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={entry.photoURL}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="w-7 h-7 rounded-full object-cover border border-hairline shrink-0"
                            />
                          ) : (
                            <span className="w-7 h-7 rounded-full bg-subtle border border-hairline font-mono text-xs font-semibold flex items-center justify-center text-ink shrink-0">
                              {(entry.handle[0] || 'A').toUpperCase()}
                            </span>
                          )}
                          <span className="font-medium text-ink group-hover:text-accent transition-colors">
                            {entry.handle}
                          </span>
                          {isMe && (
                            <span className="px-1.5 py-0.5 rounded bg-accent text-white font-mono text-[10px] font-semibold">
                              You
                            </span>
                          )}
                          {entry.isDevSeed && (
                            <span className="px-1.5 py-0.5 rounded border border-dashed border-amber-500/40 text-amber-700 dark:text-amber-300 font-mono text-[10px]">
                              Dev Seed
                            </span>
                          )}
                        </Link>
                      </td>

                      <td className="py-3.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded border font-mono text-xs font-semibold ${tier.badgeClass}`}
                        >
                          {tier.title}
                        </span>
                      </td>

                      <td
                        className={`py-3.5 px-3 text-right font-mono font-bold tabular-nums ${tier.textClass}`}
                      >
                        {ratingVal}
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                        {entry.acceptedCount}
                      </td>

                      <td className="py-3.5 pl-3 pr-4 text-right font-mono tabular-nums text-ink font-medium">
                        {entry.totalBestScore.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
