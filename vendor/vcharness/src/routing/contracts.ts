export const ROUTING_CONTRACT_VERSION = "elastic-routing-v0.1" as const;

export type RouteLane =
  | "deterministic"
  | "routine"
  | "standard"
  | "complex"
  | "frontier"
  | "wide-parallel"
  | "human-gate";

export type Complexity = "fixed" | "low" | "medium" | "high" | "frontier";
export type Risk = "low" | "medium" | "high" | "approval-required";
export type DataSensitivity = "public" | "project" | "sensitive" | "secret";
export type VerificationOutcome = "success" | "failure" | "blocker" | "unknown";

export interface RoutingWorkUnit {
  readonly workUnitId: string;
  readonly goal: string;
  readonly complexity: Complexity;
  readonly separable: boolean;
  readonly risk: Risk;
  readonly dataSensitivity: DataSensitivity;
  readonly evidenceRequired: boolean;
  readonly verificationRequired: boolean;
  readonly requiredTools: readonly string[];
  readonly aiRequired: boolean;
  readonly preferredProviders?: readonly string[];
  readonly forbiddenProviders?: readonly string[];
}

export interface ProviderCapability {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelClass: "routine" | "standard" | "complex" | "frontier" | "wide-parallel";
  readonly enabled: boolean;
  readonly supportsTools: boolean;
  readonly supportsParallel: boolean;
  readonly permittedData: readonly DataSensitivity[];
  readonly costRank: number;
  readonly health: "available" | "degraded" | "unavailable";
}

export interface RoutingDecision {
  readonly contractVersion: typeof ROUTING_CONTRACT_VERSION;
  readonly workUnitId: string;
  readonly lane: RouteLane;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly reason: string;
  readonly attemptCeiling: number;
  readonly concurrencyCap: number;
  readonly escalationLane: RouteLane | null;
  readonly verificationRequired: boolean;
  readonly humanApprovalRequired: boolean;
}

export interface RoutingTelemetry {
  readonly workUnitId: string;
  readonly decision: RoutingDecision;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly retries: number;
  readonly escalationCount: number;
  readonly durationMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly estimatedCost?: number;
  readonly workAllowanceUsed?: number;
  readonly outcome?: VerificationOutcome;
  readonly evidenceRefs: readonly string[];
}

