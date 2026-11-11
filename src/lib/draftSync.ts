import { sanitizeSnapshot } from '@/lib/dbSchema';
import type { EvaluationResult, SubmissionSnapshot } from '@/types';

/**
 * Pure helpers for keeping a problem draft "sticky" across reloads, sign-in and
 * devices. No React, no storage and no network here, so the rules are unit-tested.
 */

/** True when a draft has no boxes, no frames and no write-up text. */
export function isEmptyDraft(snap?: SubmissionSnapshot | null): boolean {
  if (!snap) return true;
  const nodes = Array.isArray(snap.nodes) ? snap.nodes.length : 0;
  const boundaries = Array.isArray(snap.boundaries) ? snap.boundaries.length : 0;
  const text =
    typeof snap.writeupMarkdown === 'string' ? snap.writeupMarkdown.trim() : '';
  return nodes === 0 && boundaries === 0 && text.length === 0;
}

function hashText(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  );
}

/**
 * Short, stable fingerprint of a draft's content. It hashes the same canonical
 * form the cloud stores (`sanitizeSnapshot`), so a draft matches its saved copy
 * even if object keys come back in another order or coordinates were unrounded.
 */
export function draftFingerprint(snap?: SubmissionSnapshot | null): string {
  const canonical = JSON.stringify(
    sanitizeSnapshot(
      snap ?? { nodes: [], edges: [], boundaries: [], writeupMarkdown: '' }
    )
  );
  return `${canonical.length}:${hashText(canonical)}`;
}

export type CloudLoadDecision = 'use_cloud' | 'keep_local' | 'in_sync';

/**
 * Decides which copy of a draft to show when the cloud copy arrives after a page
 * load.
 *
 * The cloud save is debounced, so right after typing the copy on this device can
 * be newer than the cloud copy. Loading the cloud copy over it (the old behaviour)
 * lost those last edits on a quick reload. This device's copy now wins when:
 *   - the cloud copy is empty and this device's is not, or
 *   - the cloud still holds exactly what this device last saved or loaded, which
 *     means the difference is edits made here that have not been uploaded yet.
 * Otherwise the cloud copy wins as before: it was changed on another device, or
 * this device has never synced this problem (for example a guest sketch carried
 * into an account that already has a saved draft).
 */
export function reconcileDraftOnCloudLoad(params: {
  local: SubmissionSnapshot | null | undefined;
  cloud: SubmissionSnapshot;
  lastSyncedFingerprint: string | null | undefined;
}): CloudLoadDecision {
  const { local, cloud, lastSyncedFingerprint } = params;
  if (isEmptyDraft(local)) return 'use_cloud';

  const cloudFingerprint = draftFingerprint(cloud);
  if (draftFingerprint(local) === cloudFingerprint) return 'in_sync';
  if (isEmptyDraft(cloud)) return 'keep_local';
  if (lastSyncedFingerprint && lastSyncedFingerprint === cloudFingerprint) {
    return 'keep_local';
  }
  return 'use_cloud';
}

/**
 * Moves guest sketches into a signed-in user's drafts. A guest sketch is taken
 * only where the account has nothing for that problem, so an existing account
 * draft is never overwritten.
 */
export function mergeGuestDraftsIntoAccount(
  accountDrafts: Record<string, SubmissionSnapshot>,
  guestDrafts: Record<string, SubmissionSnapshot>
): Record<string, SubmissionSnapshot> {
  const merged: Record<string, SubmissionSnapshot> = { ...accountDrafts };
  for (const [problemId, guestDraft] of Object.entries(guestDrafts)) {
    if (isEmptyDraft(guestDraft)) continue;
    if (!isEmptyDraft(merged[problemId])) continue;
    merged[problemId] = sanitizeSnapshot(guestDraft);
  }
  return merged;
}

/**
 * True when a signed-in user's official result was judged but the server did not
 * record it, so it will be missing from their profile, rating and the leaderboard.
 * The local dev test account is excluded: its results are kept in the browser.
 */
export function wasResultLeftUnsaved(params: {
  hasUser: boolean;
  isDummyUser: boolean;
  evaluation: Pick<EvaluationResult, 'integrity'>;
}): boolean {
  if (!params.hasUser || params.isDummyUser) return false;
  return params.evaluation.integrity?.submissionPersistedOnServer !== true;
}
