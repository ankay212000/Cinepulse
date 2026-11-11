import { NextResponse } from 'next/server';
import { getDefaultJudgeEngineService } from '@/server/engine/judge';
import { defaultApiJudgeController } from '@/server/security/ApiJudgeController';
import { persistAuthoritativeSubmission } from '@/server/security/AuthoritativeSubmissionRepository';
import type { EvaluateJudgeRequest } from '@/types';

export const runtime = 'nodejs';

const EVAL_MAX_PER_MIN = Number(process.env.JUDGE_RATE_LIMIT_PER_MIN ?? 30);

export async function POST(request: Request) {
  try {
    const guarded = await defaultApiJudgeController.guardAndParse<EvaluateJudgeRequest>(
      request,
      {
        bucketPrefix: 'eval',
        maxPerMinute: EVAL_MAX_PER_MIN,
        authErrorMessage: 'Authentication required to submit in competitive mode.',
      }
    );
    if (!guarded.ok) {
      return guarded.response;
    }

    const { body, problem, cleanSnapshot, verifiedUser, rate } = guarded.ctx;
    const submissionName =
      typeof body.submissionName === 'string' && body.submissionName.trim().length > 0
        ? body.submissionName.trim().slice(0, 80)
        : 'Submission';

    const evaluation = getDefaultJudgeEngineService().evaluateSubmission(
      {
        problemId: problem.id,
        nodes: cleanSnapshot.nodes,
        edges: cleanSnapshot.edges,
        boundaries: cleanSnapshot.boundaries,
        writeupMarkdown: cleanSnapshot.writeupMarkdown,
        submissionName,
      },
      problem,
      {
        verifiedUid: verifiedUser?.uid ?? null,
        leaderboardSynced: false,
        submissionPersistedOnServer: false,
      }
    );

    if (verifiedUser) {
      const persisted = await persistAuthoritativeSubmission(
        verifiedUser,
        evaluation
      );
      if (evaluation.integrity) {
        evaluation.integrity.submissionPersistedOnServer =
          persisted.persistedUserState;
        evaluation.integrity.leaderboardSynced = persisted.leaderboardSynced;
        if (!persisted.persistedUserState && persisted.failureReason) {
          evaluation.integrity.persistFailureReason = persisted.failureReason;
        }
      }
    }

    return NextResponse.json(evaluation, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-RateLimit-Remaining': String(rate.remaining),
      },
    });
  } catch (err) {
    return defaultApiJudgeController.handleUnexpectedError(
      'evaluate',
      err,
      'Judge evaluation failed unexpectedly.'
    );
  }
}
