import type { CanvasNode } from '@/types';

const CLIENT_ACTOR_RE = /^(user|users|client|clients|browser|mobile\s*app|caller)$/i;

export interface DraftWriteupStats {
  wordCount: number;
  nonClientCount: number;
  documentedCount: number;
  addressedFrCount: number;
  totalFrCount: number;
}

function stripTemplateScaffolds(rawMarkdown: string): string {
  return rawMarkdown
    .split(/\n+/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^#{1,6}\s*FR[-\s]*\d+\b/i.test(t)) return false;
      if (/^>\s+/.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/\[(?:explain|describe|your|e\.g\.|fill|todo)[^\]]*\]/gi, ' ')
    .trim();
}

function inferDraftFrKind(
  bullet: string
): 'create' | 'read' | 'lifecycle' | 'invariant' {
  const trimmed = bullet.trim();
  const lower = trimmed.toLowerCase();
  if (
    /^(?:patch\s*&\s*delete|put\s*&\s*delete|delete\b|retention\s*&\s*lifecycle)/i.test(
      trimmed
    ) ||
    /\/reverse\b/i.test(trimmed) ||
    /\b(cancels?|revokes?|deletes?|removes?|archives?|tombstones?|releases?\s+(?:canceled|expired))\b/.test(
      lower
    )
  ) {
    return 'lifecycle';
  }
  if (
    /^get\b/i.test(trimmed) ||
    (!/^(?:post|put|patch)\b/i.test(trimmed) &&
      /\b(fetches|resolves|queries|serves|returns|polls|drains|looks\s+up)\b/.test(
        lower
      ) &&
      !/\b(survive|brownout|crashes|rpo\s*=\s*0)\b/.test(lower))
  ) {
    return 'read';
  }
  if (
    /^(?:post|put|patch)\b/i.test(trimmed) ||
    /\b(creates?|stores?|accepts?|ingests?|publishes|appends?|persists?|allocates?|reserves?|books?|commits?)\b/.test(
      lower
    )
  ) {
    if (
      !/^(?:post|put|patch)\b/i.test(trimmed) &&
      /\b(must\s+survive|must\s+remain|must\s+never|read[-\s]?after[-\s]?write|system\s+must)\b/.test(
        lower
      )
    ) {
      return 'invariant';
    }
    return 'create';
  }
  return 'invariant';
}

/**
 * Pure UI helper for the Design Write-up live footer counter:
 * (`FRs mentioned: X/Y · A/B components documented · N words`).
 * Contains zero server judge/compiler imports so proprietary backend IP never enters client bundles.
 *
 * `addressedFrCount` is deliberately a rough hint: a requirement counts as soon as
 * the write-up contains any one keyword for its kind (for example "TTL" for an
 * update/delete requirement). The judge needs more than that, so this number can
 * be higher than the "covered" count a Run reports. The UI labels it "mentioned".
 */
export function computeDraftWriteupStats(
  nodes: CanvasNode[],
  writeupMarkdown: string,
  functionalRequirements: string[] = []
): DraftWriteupStats {
  const cleanProse = stripTemplateScaffolds(writeupMarkdown);
  const wordCount = cleanProse.length > 0 ? cleanProse.split(/\s+/).length : 0;
  const lowerDoc = cleanProse.toLowerCase();

  const nonClientNodes = nodes.filter(
    (n) => !CLIENT_ACTOR_RE.test(n.label.trim())
  );

  let documentedCount = 0;
  if (lowerDoc.length > 0 && nonClientNodes.length > 0) {
    for (const node of nonClientNodes) {
      const head = (
        node.label.split(/\n|\|\||\s+-\s+/)[0] ?? node.label
      ).toLowerCase();
      const tokens = head
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((tok) => tok.length >= 3);

      const mentioned =
        (head.length >= 3 && lowerDoc.includes(head)) ||
        tokens.some((tok) => lowerDoc.includes(tok));
      if (mentioned) {
        documentedCount += 1;
      }
    }
  }

  const totalFrCount = functionalRequirements.length;
  let addressedFrCount = 0;
  if (wordCount >= 12 && totalFrCount > 0) {
    for (const req of functionalRequirements) {
      const kind = inferDraftFrKind(req);
      const covered =
        kind === 'create'
          ? /\b(post|create|creates|write|writes|insert|persist|persists|store|stores|ingest|publish|enqueue|append|save)\b/.test(
              lowerDoc
            )
          : kind === 'read'
            ? /\b(get|read|reads|fetch|fetches|query|queries|lookup|resolve|redirect|cache|redis|cdn|serve|serves)\b/.test(
                lowerDoc
              )
            : kind === 'lifecycle'
              ? /\b(put|patch|delete|deletes|update|updates|remove|revoke|cancel|expire|ttl|invalidat|evict|purge|tombstone|retention|archive|reverse)\b/.test(
                  lowerDoc
                )
              : /\b(failover|replica|replicas|multi-az|quorum|eventual|read-after-write|serializable|idempoten|circuit|singleflight|retry|availab|consisten)\b/.test(
                  lowerDoc
                );
      if (covered) {
        addressedFrCount += 1;
      }
    }
  }

  return {
    wordCount,
    nonClientCount: nonClientNodes.length,
    documentedCount,
    addressedFrCount,
    totalFrCount,
  };
}
