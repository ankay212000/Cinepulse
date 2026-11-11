import { describe, expect, it } from 'vitest';
import {
  draftFingerprint,
  isEmptyDraft,
  mergeGuestDraftsIntoAccount,
  reconcileDraftOnCloudLoad,
  wasResultLeftUnsaved,
} from '../draftSync';
import type { SubmissionSnapshot } from '@/types';

function draft(writeup: string, labels: string[] = []): SubmissionSnapshot {
  return {
    nodes: labels.map((label, i) => ({
      id: `n${i + 1}`,
      label,
      x: 20 + i * 180,
      y: 40,
      width: 152,
      height: 60,
    })),
    edges:
      labels.length > 1 ? [{ id: 'e1', from: 'n1', to: 'n2', label: 'GET' }] : [],
    boundaries: [],
    writeupMarkdown: writeup,
  };
}

const EMPTY: SubmissionSnapshot = {
  nodes: [],
  edges: [],
  boundaries: [],
  writeupMarkdown: '',
};

describe('draft stickiness rules (reload, sign-in, second device)', () => {
  it('treats whitespace-only text with no boxes or frames as an empty draft', () => {
    expect(isEmptyDraft(null)).toBe(true);
    expect(isEmptyDraft(EMPTY)).toBe(true);
    expect(isEmptyDraft(draft('   \n  '))).toBe(true);
    expect(isEmptyDraft(draft('Redis first, then DynamoDB.'))).toBe(false);
    expect(isEmptyDraft(draft('', ['Cache']))).toBe(false);
    expect(
      isEmptyDraft({
        ...EMPTY,
        boundaries: [{ id: 'b1', label: 'VPC', x: 0, y: 0, width: 200, height: 120 }],
      })
    ).toBe(false);
  });

  it('gives a draft the same fingerprint as its cloud round trip (key order, unrounded coordinates)', () => {
    const local = draft('The Redirect Service reads Redis first.', ['Users', 'Cache']);
    local.nodes[0].x = 20.4;

    // Firestore returns map keys alphabetically; the stored copy was sanitized (rounded).
    const fromCloud = {
      writeupMarkdown: local.writeupMarkdown,
      boundaries: [],
      edges: [{ to: 'n2', label: 'GET', id: 'e1', from: 'n1' }],
      nodes: local.nodes.map((n) => ({
        y: n.y,
        x: Math.round(n.x),
        width: n.width,
        label: n.label,
        id: n.id,
        height: n.height,
      })),
    } as SubmissionSnapshot;

    expect(draftFingerprint(local)).toBe(draftFingerprint(fromCloud));
    expect(draftFingerprint(local)).not.toBe(
      draftFingerprint(draft('The Redirect Service reads Redis first!', ['Users', 'Cache']))
    );
    expect(draftFingerprint(local)).not.toBe(
      draftFingerprint(draft('The Redirect Service reads Redis first.', ['Users', 'Cache2']))
    );
  });

  it('keeps edits typed just before a reload when the cloud still holds the last synced copy', () => {
    const synced = draft('First paragraph.', ['Cache']);
    const typedAfter = draft('First paragraph. Second paragraph typed 1s before reload.', ['Cache']);

    expect(
      reconcileDraftOnCloudLoad({
        local: typedAfter,
        cloud: synced,
        lastSyncedFingerprint: draftFingerprint(synced),
      })
    ).toBe('keep_local');
  });

  it('takes the cloud copy when it was changed on another device since this device last synced', () => {
    const lastSyncedHere = draft('Version from Monday.', ['Cache']);
    const staleLocal = draft('Version from Monday.', ['Cache']);
    const newerFromOtherDevice = draft('Version from Tuesday, written on my laptop.', ['Cache', 'DB']);

    expect(
      reconcileDraftOnCloudLoad({
        local: staleLocal,
        cloud: newerFromOtherDevice,
        lastSyncedFingerprint: draftFingerprint(lastSyncedHere),
      })
    ).toBe('use_cloud');

    // Both sides changed: the cloud copy still wins, exactly as before this change.
    expect(
      reconcileDraftOnCloudLoad({
        local: draft('Unsynced edit on this phone.', ['Cache']),
        cloud: newerFromOtherDevice,
        lastSyncedFingerprint: draftFingerprint(lastSyncedHere),
      })
    ).toBe('use_cloud');
  });

  it('takes the cloud copy when this device has never synced the problem, or has nothing locally', () => {
    const cloud = draft('Saved in my account last week.', ['Cache']);
    expect(
      reconcileDraftOnCloudLoad({
        local: draft('Guest sketch carried into the account.', ['LB']),
        cloud,
        lastSyncedFingerprint: null,
      })
    ).toBe('use_cloud');
    expect(
      reconcileDraftOnCloudLoad({ local: EMPTY, cloud, lastSyncedFingerprint: null })
    ).toBe('use_cloud');
    expect(
      reconcileDraftOnCloudLoad({
        local: undefined,
        cloud,
        lastSyncedFingerprint: draftFingerprint(cloud),
      })
    ).toBe('use_cloud');
  });

  it('never lets an empty cloud copy wipe work that exists on this device', () => {
    expect(
      reconcileDraftOnCloudLoad({
        local: draft('Guest sketch carried into the account.', ['LB']),
        cloud: EMPTY,
        lastSyncedFingerprint: null,
      })
    ).toBe('keep_local');
  });

  it('reports in_sync when both copies hold the same content', () => {
    const a = draft('Same text.', ['Cache']);
    const b = draft('Same text.', ['Cache']);
    expect(
      reconcileDraftOnCloudLoad({ local: a, cloud: b, lastSyncedFingerprint: null })
    ).toBe('in_sync');
  });

  it('moves guest sketches into an account only where the account has no draft', () => {
    const accountDraft = draft('Already saved in the account.', ['Cache']);
    const merged = mergeGuestDraftsIntoAccount(
      {
        'url-shortener': accountDraft,
        'rate-limiter': EMPTY,
      },
      {
        'url-shortener': draft('Guest sketch for the same problem.', ['LB']),
        'rate-limiter': draft('Guest sketch for a problem the account left empty.', ['Gateway']),
        'chat-relay': draft('Guest sketch for a problem the account never opened.', ['Relay']),
        'empty-one': EMPTY,
      }
    );

    expect(merged['url-shortener']).toBe(accountDraft);
    expect(merged['rate-limiter'].writeupMarkdown).toContain('account left empty');
    expect(merged['chat-relay'].nodes[0].label).toBe('Relay');
    expect('empty-one' in merged).toBe(false);
  });

  it('tolerates malformed guest entries instead of throwing', () => {
    const merged = mergeGuestDraftsIntoAccount(
      {},
      {
        broken: { writeupMarkdown: 'Text only, arrays missing.' } as unknown as SubmissionSnapshot,
      }
    );
    expect(merged.broken.nodes).toEqual([]);
    expect(merged.broken.writeupMarkdown).toBe('Text only, arrays missing.');
  });

  it('flags an official result the server did not record, but not for guests or the dev test account', () => {
    const notSaved = {
      integrity: {
        evaluatedOnServer: true as const,
        verifiedUid: 'abc',
        leaderboardSynced: false,
        submissionPersistedOnServer: false,
        signature: null,
      },
    };
    const saved = {
      integrity: { ...notSaved.integrity, leaderboardSynced: true, submissionPersistedOnServer: true },
    };

    expect(wasResultLeftUnsaved({ hasUser: true, isDummyUser: false, evaluation: notSaved })).toBe(true);
    expect(wasResultLeftUnsaved({ hasUser: true, isDummyUser: false, evaluation: {} })).toBe(true);
    expect(wasResultLeftUnsaved({ hasUser: true, isDummyUser: false, evaluation: saved })).toBe(false);
    expect(wasResultLeftUnsaved({ hasUser: true, isDummyUser: true, evaluation: notSaved })).toBe(false);
    expect(wasResultLeftUnsaved({ hasUser: false, isDummyUser: false, evaluation: notSaved })).toBe(false);
  });
});
