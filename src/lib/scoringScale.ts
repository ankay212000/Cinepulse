import type { DifficultyLevel } from '@/types';

export interface TierRubricCaps {
  maxScore: number;
  benchmarkTargetScore: number;
  pillars: {
    latency: number;
    throughput: number;
    resilience: number;
    cost: number;
    writeup: number;
    simplicity: number;
  };
}

export const DIFFICULTY_MAX_POINTS: Record<DifficultyLevel, number> = {
  Easy: 500,
  Medium: 1000,
  Hard: 1500,
  Expert: 2000,
};

/**
 * Facts about the judge that the site states in plain words (the homepage section
 * "How scoring works, and what it cannot judge").
 *
 * `src/server/engine/__tests__/publicJudgeFacts.test.ts` checks each one against
 * the engine, so the copy cannot drift from what the judge actually does.
 */
export const PUBLIC_JUDGE_FACTS = {
  /** Official test cases a Submit is run against. */
  totalTestCases: 7,
  /** How many of those stay hidden until Submit. */
  hiddenTestCases: 4,
  /** Share of a question's marks that comes from the write-up; the rest is the simulation. */
  writeupSharePct: 60,
} as const;

/**
 * 60% Functional Requirements & Plain-English HLD Write-up (`writeup`)
 * 40% Non-Functional Diagram Simulation (`latency + throughput + resilience + cost + simplicity`)
 */
const RUBRIC_BY_DIFFICULTY: Record<DifficultyLevel, TierRubricCaps> = {
  Easy: {
    maxScore: 500,
    benchmarkTargetScore: 445,
    pillars: {
      latency: 55,
      throughput: 55,
      resilience: 45,
      cost: 30,
      writeup: 300,
      simplicity: 15,
    },
  },
  Medium: {
    maxScore: 1000,
    benchmarkTargetScore: 890,
    pillars: {
      latency: 110,
      throughput: 110,
      resilience: 90,
      cost: 60,
      writeup: 600,
      simplicity: 30,
    },
  },
  Hard: {
    maxScore: 1500,
    benchmarkTargetScore: 1335,
    pillars: {
      latency: 165,
      throughput: 165,
      resilience: 135,
      cost: 90,
      writeup: 900,
      simplicity: 45,
    },
  },
  Expert: {
    maxScore: 2000,
    benchmarkTargetScore: 1780,
    pillars: {
      latency: 220,
      throughput: 220,
      resilience: 180,
      cost: 120,
      writeup: 1200,
      simplicity: 60,
    },
  },
};

export function getMaxPointsForDifficulty(difficulty: DifficultyLevel): number {
  return DIFFICULTY_MAX_POINTS[difficulty] ?? 1000;
}

export function getRubricCapsForDifficulty(
  difficulty: DifficultyLevel
): TierRubricCaps {
  return RUBRIC_BY_DIFFICULTY[difficulty] ?? RUBRIC_BY_DIFFICULTY.Medium;
}

export function resolveSolutionMaxScore(
  metrics?: { maxScore?: number | null } | null,
  problemCode?: string | null,
  fallbackMaxPoints?: number | null
): number {
  if (metrics?.maxScore && metrics.maxScore > 0) return metrics.maxScore;
  if (fallbackMaxPoints && fallbackMaxPoints > 0) return fallbackMaxPoints;
  if (problemCode) {
    if (problemCode.startsWith('HLD-1')) return 500;
    if (problemCode.startsWith('HLD-2')) return 1000;
    if (problemCode.startsWith('HLD-3')) return 1500;
    if (problemCode.startsWith('HLD-4')) return 2000;
  }
  return 1000;
}
