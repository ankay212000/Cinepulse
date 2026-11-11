export interface CanvasNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface CanvasBoundary {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UserSubmissionInput {
  problemId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  boundaries: CanvasBoundary[];
  writeupMarkdown: string;
  submissionName?: string;
}

/**
 * Internal behavioral archetypes used strictly inside the server-side DES engine.
 * Never exposed on the authoring UI as hints or palettes.
 */
export type MockArchetype =
  | 'client'
  | 'dns_anycast'
  | 'cdn_edge'
  | 'load_balancer'
  | 'api_gateway'
  | 'stateless_compute'
  | 'in_memory_cache'
  | 'message_queue'
  | 'relational_db'
  | 'kv_nosql_db'
  | 'search_index'
  | 'object_store'
  | 'coordination_lock';

export type InstanceTier = 'small' | 'medium' | 'large';
export type RegionMode = 'single_az' | 'multi_az' | 'multi_region';

export interface SimNodeSpec {
  canvasNodeId: string;
  userLabel: string;
  archetype: MockArchetype;
  regionMode: RegionMode;
  instances: number;
  tier: InstanceTier;
  autoScale: boolean;
  sharding: {
    count: number;
    shardKey: string | null;
    strategy: 'none' | 'hash' | 'salted_hash' | 'range' | 'scatter_gather';
  };
  replication: {
    replicas: number;
    mode: 'none' | 'async' | 'sync' | 'quorum';
    readFromReplicas: boolean;
  };
  cacheConfig?: {
    memoryGb: number;
    ttlSec: number;
    writePolicy: 'cache_aside' | 'write_through' | 'write_behind';
    invalidateOnWrite: boolean;
    requestCoalescing: boolean;
    isLocalInProcess: boolean;
    isSsdTiered: boolean;
    staleWhileRevalidate: boolean;
    cachesDynamicRedirects: boolean;
  };
  queueConfig?: {
    partitions: number;
    consumers: number;
    partitionKey: string | null;
  };
  resilience: {
    retries: number;
    exponentialBackoff: boolean;
    circuitBreaker: boolean;
    rateLimitRps: number | null;
    connectionPooling: boolean;
  };
  atomicConcurrencyControl: boolean;
  parsedFacts: string[];
  pessimisticDefaults: string[];
}

export type ScenarioFlowKind =
  | 'all'
  | 'cache_hit'
  | 'cache_miss'
  | 'write_post'
  | 'node_fault';

export interface SimEdgeSpec {
  canvasEdgeId: string;
  fromNodeId: string;
  toNodeId: string;
  userLabel: string;
  interaction:
    | 'sync_request'
    | 'async_enqueue'
    | 'cache_lookup'
    | 'cache_miss_fallback'
    | 'replication';
  crossRegion: boolean;
  scenarioFlowLabel: string;
  activeInScenarios: ScenarioFlowKind[];
  writeupGrounded: boolean;
}

export type WriteupDimensionId =
  | 'fr_coverage'
  | 'prose_explanation'
  | 'api_contracts'
  | 'data_key_design'
  | 'capacity_sizing'
  | 'consistency_flow'
  | 'diagram_alignment';

export interface WriteupDimensionCheck {
  id: WriteupDimensionId;
  label: string;
  score: number;
  maxScore: number;
  status: 'strong' | 'partial' | 'missing';
  extractedSignals: string[];
  simulationImpact: string;
}

export type FunctionalRequirementKind =
  | 'create_write'
  | 'read_fetch'
  | 'update_delete'
  | 'invariant_slo';

export interface ProseQualityReport {
  wordCount: number;
  sentenceOrClauseCount: number;
  engineeringVerbCount: number;
  connectorCount: number;
  uniqueTokenRatio: number;
  promptCopyOverlapRatio: number;
  isNaturalProse: boolean;
  isKeywordSpam: boolean;
  isPromptCopyPaste: boolean;
  score: number;
  maxScore: number;
  feedback: string[];
}

export interface FunctionalRequirementCheckItem {
  index: number;
  id: string;
  requirementText: string;
  kind: FunctionalRequirementKind;
  status: 'covered' | 'partial' | 'missing';
  earnedPoints: number;
  maxPoints: number;
  matchedSignals: string[];
  reason: string;
}

export interface DiagramFrHint {
  id: string;
  relatedFrIndex: number | null;
  severity: 'warning' | 'tip';
  title: string;
  suggestion: string;
}

export interface FunctionalEvaluationReport {
  passesFunctionalGate: boolean;
  gateFailureReason: string | null;
  coveredCount: number;
  partialCount: number;
  missingCount: number;
  totalRequirements: number;
  coverageRatio: number;
  frScore: number;
  frMaxScore: number;
  prose: ProseQualityReport;
  items: FunctionalRequirementCheckItem[];
  diagramFrHints: DiagramFrHint[];
}

export interface WriteupAnalysis {
  wordCount: number;
  totalScore: number;
  explainedNodeIds: string[];
  unexplainedNodeLabels: string[];
  undrawnWriteupClaims: string[];
  extractedReadEndpoint: string | null;
  extractedWriteEndpoint: string | null;
  extractedRedirectCode: string | null;
  idGenerationScheme: string | null;
  hasLockFreeIdGen: boolean;
  hasCapacitySizingMath: boolean;
  hasBoundedFeedOrPagination: boolean;
  hasExplicitConsistencyModel: boolean;
  hasAsyncCacheBackfill: boolean;
  dimensions: WriteupDimensionCheck[];
  functionalAnalysis?: FunctionalEvaluationReport;
}

export type AlignmentFlagKind =
  | 'writeup_missing_on_diagram'
  | 'diagram_missing_in_writeup'
  | 'disconnected_diagram_node'
  | 'parameter_conflict';

export interface AlignmentFlag {
  id: string;
  kind: AlignmentFlagKind;
  severity: 'warning' | 'info';
  title: string;
  detail: string;
}

export interface SimGraphIR {
  nodes: SimNodeSpec[];
  edges: SimEdgeSpec[];
  compilerMode: 'strict_deterministic' | 'llm_schema_locked';
  topologyWarnings: string[];
  writeup: WriteupAnalysis;
  alignmentFlags?: AlignmentFlag[];
  functionalAnalysis?: FunctionalEvaluationReport;
}

export type ConsistencyMode =
  | 'eventual'
  | 'read_after_write'
  | 'strict_serializable_inventory';

export type WavePhaseType = 'baseline' | 'burst_skew' | 'chaos';

/**
 * Sanitized wave marker safe to expose to the client timeline scrubber & charts.
 * Contains zero internal Zipfian alpha, skew key, or fault-injection parameters.
 */
export interface PublicWaveSpec {
  name: string;
  type: WavePhaseType;
  startSec: number;
  endSec: number;
}

/**
 * Full server-only wave physics specification. Never serialized to client bundles.
 */
export interface TrafficWaveSpec extends PublicWaveSpec {
  readRps: number;
  writeRps: number;
  zipfAlpha: number;
  skewKey: string;
  chaosFault?: {
    kind: 'primary_db_crash' | 'storage_gray_latency';
    triggerSec: number;
    recoverSec: number;
    latencyMultiplier?: number;
  };
}

export type DifficultyLevel = 'Easy' | 'Medium' | 'Hard' | 'Expert';

export interface BenchmarkPoint {
  timeSec: number;
  p99Ms: number;
  goodputRps: number;
  availabilityPct: number;
}

/**
 * Compact public metadata used on `/problemset` and navigation lists.
 */
export interface PublicProblemSummary {
  id: string;
  code: string;
  title: string;
  difficulty: DifficultyLevel;
  maxPoints: number;
  category: string;
  summary: string;
}

export interface PublicProblemNavLink {
  id: string;
  code: string;
  title: string;
}

export interface PublicSampleTestCase {
  index: number;
  id: string;
  title: string;
  categoryLabel: string;
  inputSummary: {
    readRps: number;
    writeRps: number;
    durationSec: number;
    skewLabel: string;
    faultLabel: string;
  };
  expectedCriteria: {
    maxP99Ms: number;
    minAvailabilityPct: number;
    maxMonthlyBudgetUsd?: number;
    invariantNote: string;
  };
}

export type CustomFaultKind = 'none' | 'primary_db_crash' | 'storage_gray_latency';
export type CustomSkewLevel = 'uniform' | 'moderate' | 'viral_hotkey';

export interface CustomTestCaseInput {
  readRps: number;
  writeRps: number;
  skewLevel: CustomSkewLevel;
  faultKind: CustomFaultKind;
}

export type TestCaseStatus = 'passed' | 'failed' | 'locked';

export interface TestCaseResult {
  index: number;
  id: string;
  title: string;
  visibility: 'sample' | 'hidden' | 'custom';
  status: TestCaseStatus;
  verdict: VerdictCode | null;
  inputSummary: {
    readRps: number;
    writeRps: number;
    skewLabel: string;
    faultLabel: string;
  } | null;
  expectedSummary: string | null;
  actualMetrics: {
    p99Ms: number;
    p50Ms: number;
    availabilityPct: number;
    goodputRps: number;
    offeredRps: number;
    monthlyCostUsd: number;
    consistencyViolations: number;
  } | null;
  diagnostic: string | null;
}

export interface TestSuiteSummary {
  mode: 'sample_run' | 'full_submit';
  passedCount: number;
  totalCount: number;
  firstFailedCaseIndex: number | null;
  cases: TestCaseResult[];
  customCaseResult?: TestCaseResult | null;
  alignmentFlags?: AlignmentFlag[];
  functionalAnalysis?: FunctionalEvaluationReport;
}

/**
 * Sanitized problem specification passed from Server Components to the browser.
 * Excludes all grading answer keys (`idealShardKeys`, `scatterGatherTrapKeys`,
 * `workingSetGb`, `cacheableReadFraction`, `staticCdnFraction`, `consistencyRequirement`,
 * and internal wave fault parameters).
 */
export interface PublicProblemSpec extends PublicProblemSummary {
  functionalRequirements: string[];
  scaleSpecs: Array<{ label: string; value: string }>;
  consistencyDescription: string;
  slo: {
    maxP99Ms: number;
    minAvailabilityPct: number;
  };
  monthlyBudgetUsd: number;
  waves: PublicWaveSpec[];
  benchmarkCurve: BenchmarkPoint[];
  benchmarkMonthlyCostUsd: number;
  sampleTestCases: PublicSampleTestCase[];
  totalTestCaseCount: number;
}

/**
 * Server-only complete problem specification used strictly inside `src/server/*`.
 */
export interface ProblemSpec
  extends Omit<
    PublicProblemSpec,
    'waves' | 'sampleTestCases' | 'totalTestCaseCount' | 'maxPoints'
  > {
  maxPoints?: number;
  consistencyRequirement: ConsistencyMode;
  idealShardKeys: string[];
  scatterGatherTrapKeys: string[];
  workingSetGb: number;
  cacheableReadFraction: number;
  staticCdnFraction: number;
  waves: TrafficWaveSpec[];
}

export type NodeHealthStatus =
  | 'idle'
  | 'healthy'
  | 'elevated'
  | 'saturated'
  | 'crashed';

export interface TickNodeTelemetry {
  arrivingRps: number;
  servedRps: number;
  droppedRps: number;
  utilization: number;
  hotShardUtilization: number;
  queueDepth: number;
  queueMax: number;
  localP99Ms: number;
  cacheHitRate?: number;
  status: NodeHealthStatus;
  symptomBadge: string | null;
}

export interface TickEdgeTelemetry {
  rps: number;
  returnHitRps: number;
  errorRps: number;
  hopLatencyMs: number;
  retryAmplified: boolean;
}

export interface SimulationFrame {
  tick: number;
  timeSec: number;
  waveName: string;
  waveType: WavePhaseType;
  offeredRps: number;
  goodputRps: number;
  errorRps: number;
  p50Ms: number;
  p99Ms: number;
  availabilityPct: number;
  consistencyViolationsThisTick: number;
  activeNarrative: string;
  nodes: Record<string, TickNodeTelemetry>;
  edges: Record<string, TickEdgeTelemetry>;
}

export type VerdictCode =
  | 'AC'
  | 'WA_FUNCTIONAL'
  | 'WA_CONSISTENCY'
  | 'TLE_LATENCY_SLO'
  | 'AVAILABILITY_BREACH'
  | 'MLE_OVER_BUDGET'
  | 'INVALID_TOPOLOGY';

export interface CostLineItem {
  canvasNodeId: string;
  userLabel: string;
  monthlyUsd: number;
  detail: string;
}

export interface ScoreBreakdown {
  verdict: VerdictCode;
  verdictTitle: string;
  verdictSymptom: string;
  totalScore: number;
  maxScore?: number;
  pillars: {
    latency: number;
    throughput: number;
    resilience: number;
    cost: number;
    writeup: number;
    simplicity: number;
  };
  metrics: {
    weightedP50Ms: number;
    weightedP99Ms: number;
    peakGoodputRps: number;
    peakOfferedRps: number;
    overallAvailabilityPct: number;
    chaosAvailabilityPct: number;
    rtoSec: number;
    monthlyCostUsd: number;
    costPerMillionReqUsd: number;
    consistencyViolations: number;
    consistencySymptom: string | null;
  };
  costBreakdown: CostLineItem[];
}

export interface SubmissionSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  boundaries: CanvasBoundary[];
  writeupMarkdown: string;
}

export interface EvaluationIntegrityReceipt {
  evaluatedOnServer: true;
  verifiedUid: string | null;
  leaderboardSynced: boolean;
  submissionPersistedOnServer?: boolean;
  /** Short diagnostic code when the server judged the run but could not record it. */
  persistFailureReason?: string;
  signature: string | null;
}

export interface EvaluationResult {
  submissionId: string;
  submissionName: string;
  submittedAtIso: string;
  problemId: string;
  snapshot: SubmissionSnapshot;
  ir: SimGraphIR;
  frames: SimulationFrame[];
  score: ScoreBreakdown;
  testSuite?: TestSuiteSummary;
  integrity?: EvaluationIntegrityReceipt;
}

export interface EvaluateJudgeRequest {
  problemId: string;
  snapshot: SubmissionSnapshot;
  submissionName?: string;
}

export interface RunJudgeRequest {
  problemId: string;
  snapshot: SubmissionSnapshot;
  customTestCase?: CustomTestCaseInput | null;
}

export interface RunJudgeResponse {
  problemId: string;
  evaluatedAtIso: string;
  ir: SimGraphIR;
  testSuite: TestSuiteSummary;
}

export interface ReplayJudgeRequest {
  problemId: string;
  snapshot: SubmissionSnapshot;
  submissionId?: string;
  submissionName?: string;
  submittedAtIso?: string;
}

export interface LeaderboardEntry {
  uid: string;
  handle: string;
  photoURL: string | null;
  rating?: number;
  rankTitle?: string;
  acceptedCount: number;
  attemptedCount: number;
  totalBestScore: number;
  problemScores?: Record<string, { score: number; ac: boolean }>;
  updatedAtIso: string;
  isDevSeed?: boolean;
}

export type CommunityCategory =
  | 'interview_experience'
  | 'solution'
  | 'general_discussion';

export type VoteDirection = 1 | -1 | 0;

export interface SolutionMetricsBadge {
  p99Ms: number;
  availabilityPct: number;
  monthlyCostUsd: number;
  totalScore: number;
  maxScore?: number;
  verdict: 'AC';
}

export interface CommunityPostSummary {
  postId: string;
  authorUid: string;
  authorName: string;
  authorPhotoURL: string | null;
  category: CommunityCategory;
  title: string;
  previewExcerpt: string;
  bodyMarkdown: string | null;
  tags: string[];
  companyTag: string | null;
  roleTag: string | null;
  problemId: string | null;
  problemCode: string | null;
  problemTitle: string | null;
  solutionMetrics: SolutionMetricsBadge | null;
  upvotes: number;
  downvotes: number;
  netVotes: number;
  commentCount: number;
  createdAtMs: number;
}

export interface ProtectedSolutionContent {
  postId: string;
  authorUid: string;
  problemId: string;
  bodyMarkdown: string;
  solutionSnapshot: SubmissionSnapshot;
}

export interface CommunityComment {
  commentId: string;
  postId: string;
  authorUid: string;
  authorName: string;
  authorPhotoURL: string | null;
  body: string;
  createdAtMs: number;
}
