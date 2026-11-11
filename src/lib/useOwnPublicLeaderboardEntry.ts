'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { getFirestoreDb } from '@/lib/firebase';
import { getRatingTier, INITIAL_RATING } from '@/lib/ratingSystem';
import type { LeaderboardEntry } from '@/types';

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The signed-in user's row in the PUBLIC `leaderboard` collection, read straight
 * from Firestore, or null when the server has not recorded any of their results.
 *
 * The leaderboard and share-card pages are cached for a few seconds, so right after
 * a first Submit the user's row may not be in the cached list yet. Pages use this to
 * bridge that gap with the same data every other visitor is about to see. They must
 * not build the row from the user's private profile instead: that showed people a
 * row or card of their own that nobody else could see.
 */
export function useOwnPublicLeaderboardEntry(
  uid: string | null | undefined,
  enabled: boolean
): LeaderboardEntry | null {
  const [entry, setEntry] = useState<LeaderboardEntry | null>(null);

  useEffect(() => {
    if (!uid || !enabled) {
      setEntry(null);
      return;
    }

    let cancelled = false;
    getDoc(doc(getFirestoreDb(), 'leaderboard', uid))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setEntry(null);
          return;
        }
        const data = snap.data() as Record<string, unknown>;

        let problemScores: LeaderboardEntry['problemScores'];
        if (typeof data.problemScoresJson === 'string') {
          try {
            problemScores = JSON.parse(data.problemScoresJson) as Record<
              string,
              { score: number; ac: boolean }
            >;
          } catch {
            problemScores = undefined;
          }
        }

        const rating = Math.round(toFiniteNumber(data.rating, INITIAL_RATING));
        setEntry({
          uid,
          handle:
            typeof data.handle === 'string' && data.handle.trim().length > 0
              ? data.handle
              : 'System Architect',
          photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
          rating,
          rankTitle:
            typeof data.rankTitle === 'string' && data.rankTitle.length > 0
              ? data.rankTitle
              : getRatingTier(rating).title,
          acceptedCount: toFiniteNumber(data.acceptedCount, 0),
          attemptedCount: toFiniteNumber(data.attemptedCount, 0),
          totalBestScore: toFiniteNumber(data.totalBestScore, 0),
          problemScores,
          updatedAtIso:
            typeof data.updatedAtIso === 'string' ? data.updatedAtIso : '',
        });
      })
      .catch(() => {
        if (!cancelled) setEntry(null);
      });

    return () => {
      cancelled = true;
    };
  }, [uid, enabled]);

  return entry;
}
