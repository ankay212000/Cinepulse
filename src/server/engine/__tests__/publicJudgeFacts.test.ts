import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_URL_SHORTENER_DESIGN,
  NOT_ACCEPTED_URL_SHORTENER_DESIGN,
} from '@/server/__tests__/fixtures/urlShortenerDesigns';
import { getRubricCapsForDifficulty, PUBLIC_JUDGE_FACTS } from '@/lib/scoringScale';
import type { DifficultyLevel, UserSubmissionInput } from '@/types';
import { getProblemById } from '../../problems/catalog';
import { evaluateUserSubmission } from '../judge';
import { TOTAL_JUDGE_TEST_CASES } from '../testCases';

/**
 * The homepage section "How scoring works, and what it cannot judge" states a few
 * facts about the judge in plain words. Each test below ties one of those sentences
 * to the engine, so the copy cannot quietly become untrue.
 */
describe('Facts the homepage states about the judge', () => {
  const problem = getProblemById('url-shortener');
  const accepted: UserSubmissionInput = {
    problemId: problem.id,
    ...ACCEPTED_URL_SHORTENER_DESIGN,
  };

  it('"7 test cases ... 4 of the 7 are hidden"', () => {
    expect(PUBLIC_JUDGE_FACTS.totalTestCases).toBe(TOTAL_JUDGE_TEST_CASES);

    const cases = evaluateUserSubmission(accepted, problem).testSuite?.cases;
    expect(cases).toHaveLength(PUBLIC_JUDGE_FACTS.totalTestCases);
    expect(cases?.filter((c) => c.visibility === 'hidden')).toHaveLength(
      PUBLIC_JUDGE_FACTS.hiddenTestCases
    );
  });

  it('"Marks are 60% write-up, 40% simulation" on every difficulty', () => {
    const difficulties: DifficultyLevel[] = ['Easy', 'Medium', 'Hard', 'Expert'];
    for (const difficulty of difficulties) {
      const { maxScore, pillars } = getRubricCapsForDifficulty(difficulty);
      expect((pillars.writeup / maxScore) * 100).toBe(
        PUBLIC_JUDGE_FACTS.writeupSharePct
      );
      // Everything that is not the write-up comes from simulating the diagram
      const simulation =
        pillars.latency +
        pillars.throughput +
        pillars.resilience +
        pillars.cost +
        pillars.simplicity;
      expect(pillars.writeup + simulation).toBe(maxScore);
    }
  });

  it('"the same design always gets the same score"', () => {
    for (const design of [
      ACCEPTED_URL_SHORTENER_DESIGN,
      NOT_ACCEPTED_URL_SHORTENER_DESIGN,
    ]) {
      const input: UserSubmissionInput = { problemId: problem.id, ...design };
      const first = evaluateUserSubmission(input, problem);
      const second = evaluateUserSubmission(input, problem);
      expect(first.testSuite).toBeDefined();
      expect(first.frames.length).toBeGreaterThan(0);
      expect(second.score).toEqual(first.score);
      expect(second.testSuite).toEqual(first.testSuite);
      expect(second.frames).toEqual(first.frames);
    }
  });

  it('"Accepted needs both: the write-up check and every limit"', () => {
    // The fixture really is Accepted, so the two cases below fail for the stated reason
    expect(evaluateUserSubmission(accepted, problem).score.verdict).toBe('AC');

    // Same diagram, but the write-up is a keyword list
    const keywordList = evaluateUserSubmission(
      {
        ...accepted,
        writeupMarkdown:
          'Redis DynamoDB CDN cache shards replicas quorum failover singleflight TTL Base62 Snowflake multi-AZ',
      },
      problem
    );
    expect(keywordList.score.verdict).not.toBe('AC');

    // Same write-up, but the cache and CDN it describes were never drawn
    // (Users still reach the Load Balancer through the remaining arrow)
    const dropped = new Set(['cdn', 'cache']);
    const missingBoxes = evaluateUserSubmission(
      {
        ...accepted,
        nodes: accepted.nodes.filter((n) => !dropped.has(n.id)),
        edges: accepted.edges.filter(
          (e) => !dropped.has(e.from) && !dropped.has(e.to)
        ),
      },
      problem
    );
    expect(missingBoxes.score.verdict).not.toBe('AC');
    expect(
      missingBoxes.ir.nodes.some((n) => n.archetype === 'in_memory_cache')
    ).toBe(false);
  });
});
