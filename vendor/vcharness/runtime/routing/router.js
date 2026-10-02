import {
  ROUTING_CONTRACT_VERSION,
                          
                 
                       
                       
} from "./contracts.js";
import { eligibleProviders } from "./registry.js";

function modelClassFor(lane           )                                          {
  switch (lane) {
    case "routine": return "routine";
    case "standard": return "standard";
    case "complex": return "complex";
    case "frontier": return "frontier";
    case "wide-parallel": return "wide-parallel";
    default: return null;
  }
}

export function classifyLane(unit                 )            {
  if (unit.risk === "approval-required" || unit.dataSensitivity === "secret") return "human-gate";
  if (!unit.aiRequired || unit.complexity === "fixed") return "deterministic";
  if (unit.separable && unit.complexity !== "frontier") return "wide-parallel";
  if (unit.complexity === "low") return "routine";
  if (unit.complexity === "medium") return "standard";
  if (unit.complexity === "high") return "complex";
  return "frontier";
}

export function escalationFor(lane           )                   {
  switch (lane) {
    case "routine": return "standard";
    case "standard": return "complex";
    case "complex": return "frontier";
    case "wide-parallel": return "complex";
    default: return null;
  }
}

export function routeWorkUnit(
  unit                 ,
  registry                               ,
)                  {
  const requestedLane = classifyLane(unit);
  if (requestedLane === "deterministic" || requestedLane === "human-gate") {
    return {
      contractVersion: ROUTING_CONTRACT_VERSION,
      workUnitId: unit.workUnitId,
      lane: requestedLane,
      providerId: null,
      modelId: null,
      reason: requestedLane === "deterministic"
        ? "AI is unnecessary for this bounded work unit."
        : "Human authority or protected data blocks automatic model dispatch.",
      attemptCeiling: 1,
      concurrencyCap: 1,
      escalationLane: null,
      verificationRequired: unit.verificationRequired,
      humanApprovalRequired: requestedLane === "human-gate",
    };
  }

  const modelClass = modelClassFor(requestedLane) ;
  const candidates = eligibleProviders(
    registry,
    modelClass,
    unit.dataSensitivity,
    unit.requiredTools,
    unit.forbiddenProviders,
  );

  const selected = candidates[0];
  if (!selected) {
    return {
      contractVersion: ROUTING_CONTRACT_VERSION,
      workUnitId: unit.workUnitId,
      lane: "human-gate",
      providerId: null,
      modelId: null,
      reason: `No permitted and available provider can satisfy the ${requestedLane} route.`,
      attemptCeiling: 1,
      concurrencyCap: 1,
      escalationLane: escalationFor(requestedLane),
      verificationRequired: true,
      humanApprovalRequired: true,
    };
  }

  return {
    contractVersion: ROUTING_CONTRACT_VERSION,
    workUnitId: unit.workUnitId,
    lane: requestedLane,
    providerId: selected.providerId,
    modelId: selected.modelId,
    reason: `Lowest-cost permitted available ${requestedLane} route for this work unit.`,
    attemptCeiling: requestedLane === "frontier" ? 1 : 2,
    concurrencyCap: requestedLane === "wide-parallel" ? 8 : 1,
    escalationLane: escalationFor(requestedLane),
    verificationRequired: unit.verificationRequired,
    humanApprovalRequired: false,
  };
}
