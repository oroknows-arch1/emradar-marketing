export const MOONSHOT_DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";
export const MOONSHOT_DEFAULT_MODEL = "kimi-k3";

export interface MoonshotConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface MoonshotHealth {
  available: boolean;
  model: string;
  detail: string;
}

export function moonshotConfig(env: NodeJS.ProcessEnv = process.env): MoonshotConfig | null {
  const apiKey = env.MOONSHOT_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.MOONSHOT_BASE_URL?.trim() || MOONSHOT_DEFAULT_BASE_URL).replace(/\/$/, ""),
    model: env.MOONSHOT_MODEL?.trim() || MOONSHOT_DEFAULT_MODEL,
  };
}

async function request(config: MoonshotConfig, body: unknown): Promise<Response> {
  return fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function checkMoonshot(config: MoonshotConfig): Promise<MoonshotHealth> {
  try {
    const response = await request(config, {
      model: config.model,
      messages: [{ role: "user", content: "Reply exactly: OK" }],
      max_tokens: 4,
      temperature: 1,
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300).replace(/\s+/g, " ");
      return { available: false, model: config.model, detail: `HTTP ${response.status}: ${text}` };
    }
    return { available: true, model: config.model, detail: "live API check passed" };
  } catch (error) {
    return { available: false, model: config.model, detail: error instanceof Error ? error.message : "unknown error" };
  }
}

export async function dispatchMoonshot(
  config: MoonshotConfig,
  messages: readonly { role: "system" | "user" | "assistant"; content: string }[],
): Promise<unknown> {
  const response = await request(config, { model: config.model, messages });
  if (!response.ok) throw new Error(`Moonshot request failed with HTTP ${response.status}`);
  return response.json();
}

