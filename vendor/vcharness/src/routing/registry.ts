import { checkMoonshot, moonshotConfig } from "../providers/moonshot.js";
import type { ProviderCapability } from "./contracts.js";

export const DEFAULT_PROVIDER_REGISTRY: readonly ProviderCapability[] = [
  {
    providerId: "openai",
    modelId: "luna",
    modelClass: "routine",
    enabled: true,
    supportsTools: true,
    supportsParallel: false,
    permittedData: ["public", "project"],
    costRank: 1,
    health: "available",
  },
  {
    providerId: "openai",
    modelId: "terra",
    modelClass: "standard",
    enabled: true,
    supportsTools: true,
    supportsParallel: false,
    permittedData: ["public", "project"],
    costRank: 2,
    health: "available",
  },
  {
    providerId: "openai",
    modelId: "sol",
    modelClass: "complex",
    enabled: true,
    supportsTools: true,
    supportsParallel: false,
    permittedData: ["public", "project"],
    costRank: 3,
    health: "available",
  },
  {
    providerId: "openai",
    modelId: "astra",
    modelClass: "frontier",
    enabled: true,
    supportsTools: true,
    supportsParallel: true,
    permittedData: ["public", "project"],
    costRank: 5,
    health: "available",
  },
  {
    providerId: "moonshot",
    modelId: "kimi-k3",
    modelClass: "wide-parallel",
    enabled: false,
    supportsTools: true,
    supportsParallel: true,
    permittedData: ["public"],
    costRank: 2,
    health: "unavailable",
  },
];

export function eligibleProviders(
  registry: readonly ProviderCapability[],
  modelClass: ProviderCapability["modelClass"],
  dataSensitivity: ProviderCapability["permittedData"][number],
  requiredTools: readonly string[],
  forbiddenProviders: readonly string[] = [],
): readonly ProviderCapability[] {
  return registry
    .filter((entry) => entry.enabled)
    .filter((entry) => entry.health !== "unavailable")
    .filter((entry) => entry.modelClass === modelClass)
    .filter((entry) => modelClass !== "wide-parallel" || entry.supportsParallel)
    .filter((entry) => entry.permittedData.includes(dataSensitivity))
    .filter((entry) => !forbiddenProviders.includes(entry.providerId))
    .filter((entry) => requiredTools.length === 0 || entry.supportsTools)
    .sort((a, b) => a.costRank - b.costRank);
}

export async function createRuntimeProviderRegistry(
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly ProviderCapability[]> {
  const config = moonshotConfig(env);
  if (!config) return DEFAULT_PROVIDER_REGISTRY;

  const health = await checkMoonshot(config);
  return DEFAULT_PROVIDER_REGISTRY.map((entry) =>
    entry.providerId === "moonshot"
      ? {
          ...entry,
          modelId: config.model,
          enabled: health.available,
          health: health.available ? ("available" as const) : ("unavailable" as const),
        }
      : entry,
  );
}

