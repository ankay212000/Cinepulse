import { sanitizeSnapshot } from '@/lib/dbSchema';
import type { SubmissionSnapshot } from '@/types';

/**
 * Browser storage for problem drafts. Client-only: every function is a no-op (or
 * returns an empty value) when storage is unavailable, so callers never throw.
 */

/** Per-tab guest drafts used before guest drafts became persistent. Read as a fallback only. */
export const LEGACY_SESSION_GUEST_DRAFTS_KEY = 'sysjudge_guest_drafts_v1';

/**
 * Signed-out visitors' drafts. Kept in localStorage (not sessionStorage) so a
 * sketch survives reloads, a closed tab and in-app browsers that discard the page.
 * Cleared on explicit sign-out and once the sketches move into an account.
 */
export const GUEST_DRAFTS_KEY = 'sysjudge_guest_drafts_v2';

export function getScopedDraftsKey(uid: string): string {
  return `sysjudge_drafts_v2:${uid}`;
}

export function getScopedRunsKey(uid: string): string {
  return `sysjudge_runs_meta_v2:${uid}`;
}

function getCloudSyncedKey(uid: string): string {
  return `sysjudge_cloud_synced_v1:${uid}`;
}

/**
 * Parses a stored `{ problemId: draft }` map. Malformed JSON or entries yield an
 * empty map / are skipped instead of throwing, and every draft is normalised so
 * later code can rely on `nodes`, `edges` and `boundaries` being arrays.
 */
export function parseDraftMap(
  raw: string | null | undefined
): Record<string, SubmissionSnapshot> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, SubmissionSnapshot> = {};
    for (const [problemId, value] of Object.entries(parsed)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        out[problemId] = sanitizeSnapshot(value as SubmissionSnapshot);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function readGuestDrafts(): Record<string, SubmissionSnapshot> {
  if (typeof window === 'undefined') return {};
  try {
    const raw =
      window.localStorage.getItem(GUEST_DRAFTS_KEY) ??
      window.sessionStorage.getItem(LEGACY_SESSION_GUEST_DRAFTS_KEY);
    return parseDraftMap(raw);
  } catch {
    return {};
  }
}

export function writeGuestDrafts(
  drafts: Record<string, SubmissionSnapshot>
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // Ignore storage quota / privacy-mode errors
  }
}

export function clearGuestDrafts(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GUEST_DRAFTS_KEY);
    window.sessionStorage.removeItem(LEGACY_SESSION_GUEST_DRAFTS_KEY);
  } catch {
    // Ignore storage access errors
  }
}

export function readAccountDrafts(
  uid: string
): Record<string, SubmissionSnapshot> {
  if (typeof window === 'undefined') return {};
  try {
    return parseDraftMap(window.localStorage.getItem(getScopedDraftsKey(uid)));
  } catch {
    return {};
  }
}

function readSyncedMap(uid: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(getCloudSyncedKey(uid));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [problemId, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[problemId] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Fingerprint of the draft this device last saved to, or loaded from, the cloud
 * for a problem (see `draftFingerprint`). Null when this device never synced it.
 */
export function readSyncedFingerprint(
  uid: string,
  problemId: string
): string | null {
  return readSyncedMap(uid)[problemId] ?? null;
}

export function writeSyncedFingerprint(
  uid: string,
  problemId: string,
  fingerprint: string
): void {
  if (typeof window === 'undefined') return;
  try {
    const map = readSyncedMap(uid);
    if (map[problemId] === fingerprint) return;
    map[problemId] = fingerprint;
    window.localStorage.setItem(getCloudSyncedKey(uid), JSON.stringify(map));
  } catch {
    // Ignore storage quota / privacy-mode errors
  }
}
