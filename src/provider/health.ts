import { LMSTUDIO_URL, type Profile } from "./profiles.ts";

export interface HealthResult {
  ok: boolean;
  message: string;
  availableModels: string[];
}

/** Ping LM Studio and verify the profile's model is loadable. */
export async function checkHealth(profile: Profile): Promise<HealthResult> {
  try {
    const res = await fetch(`${LMSTUDIO_URL}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return {
        ok: false,
        availableModels: [],
        message: `LM Studio responded ${res.status} at ${LMSTUDIO_URL}`,
      };
    }
    const body = (await res.json()) as { data?: { id: string }[] };
    const ids = (body.data ?? []).map((m) => m.id);
    if (!ids.includes(profile.model)) {
      return {
        ok: false,
        availableModels: ids,
        message:
          `model '${profile.model}' not available on the server.\n` +
          `Available: ${ids.join(", ") || "(none)"}\n` +
          `Hint: check the exact key with 'lms ls' or download it via LM Studio.`,
      };
    }
    return { ok: true, availableModels: ids, message: "ok" };
  } catch {
    return {
      ok: false,
      availableModels: [],
      message:
        `cannot reach LM Studio at ${LMSTUDIO_URL}.\n` +
        `Hint: start it with '~/src/local-claude/server.sh start' (or 'lms server start').`,
    };
  }
}
