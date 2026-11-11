import type { CanvasBoundary, CanvasEdge, CanvasNode } from '@/types';

/**
 * Two fixed URL Shortener (HLD-201) designs for tests of what gets recorded:
 * one the judge accepts, and one it does not.
 *
 * Tests that depend on the verdict assert it, so a change in the judge that flips
 * either design shows up as a clear failure instead of a silently weaker test.
 */

interface DesignFixture {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  boundaries: CanvasBoundary[];
  writeupMarkdown: string;
}

const box = (id: string, label: string, x: number, y: number): CanvasNode => ({
  id,
  label,
  x,
  y,
  width: 152,
  height: 60,
});

/** Judged Accepted (AC). Same design as the homepage walkthrough. */
export const ACCEPTED_URL_SHORTENER_DESIGN: DesignFixture = {
  nodes: [
    box('users', 'Users', 10, 216),
    box('cdn', 'CDN Edge', 274, 80),
    box('lb', 'Load Balancer x2', 274, 216),
    box('api', 'Redirect Service x6 medium', 478, 216),
    box('cache', 'Redis Cache 24GB', 478, 80),
    box('db', 'DynamoDB KV Store', 478, 352),
  ],
  edges: [
    { id: 'e1', from: 'users', to: 'cdn', label: 'GET /{code}' },
    { id: 'e2', from: 'cdn', to: 'lb', label: 'miss' },
    { id: 'e3', from: 'users', to: 'lb', label: 'POST /shorten' },
    { id: 'e4', from: 'lb', to: 'api', label: '' },
    { id: 'e5', from: 'api', to: 'cache', label: 'cache-aside' },
    { id: 'e6', from: 'api', to: 'db', label: 'by short_code' },
  ],
  boundaries: [],
  writeupMarkdown: `### FR-1: Create a short link
POST /shorten goes through the Load Balancer to the Redirect Service. The service generates a unique 7-character Base62 short_code from a Snowflake ID, stores the short_code to long URL mapping in the DynamoDB KV Store, and returns the short link.

### FR-2: Redirect
GET /{short_code} is answered by the CDN Edge when the redirect is already cached there. On a miss the Redirect Service reads Redis Cache first (cache-aside, TTL 120s, singleflight so a hot link triggers one database read) and falls back to DynamoDB, then returns an HTTP 302.

### FR-3: Update and delete
PATCH and DELETE /{short_code} are allowed only for the link owner. The Redirect Service writes the change to DynamoDB first, then does an explicit cache eviction of the Redis key and purges the CDN entry, so the old destination stops being served.

### FR-4: Stay available when a node fails
- Load Balancer: 2 medium instances, multi-AZ.
- Redirect Service: 6 medium stateless instances with connection pooling, multi-AZ.
- Redis Cache: 24 GB RAM with 1 replica, cache-aside with write invalidation on PATCH and DELETE.
- DynamoDB KV Store: 2 shards partitioned by salted short_code, quorum replication with 2 replicas, automatic failover in under 2 seconds.`,
};

/** Judged, scored, and not Accepted. */
export const NOT_ACCEPTED_URL_SHORTENER_DESIGN: DesignFixture = {
  nodes: [
    { id: 'cl', label: 'Clients', x: 20, y: 80, width: 120, height: 50 },
    { id: 'api', label: 'API Service x6 medium', x: 220, y: 80, width: 150, height: 50 },
    { id: 'rc', label: 'Redis Cache x2', x: 420, y: 30, width: 150, height: 50 },
    { id: 'db', label: 'DynamoDB Store', x: 420, y: 140, width: 150, height: 50 },
  ],
  edges: [
    { id: 'e1', from: 'cl', to: 'api' },
    { id: 'e2', from: 'api', to: 'rc' },
    { id: 'e3', from: 'api', to: 'db' },
  ],
  boundaries: [],
  writeupMarkdown:
    'API Service x6 medium with singleflight and connection pooling; Redis 24 GB RAM TTL 120s; DynamoDB 2 shards salted short_code quorum 2 replicas.',
};
