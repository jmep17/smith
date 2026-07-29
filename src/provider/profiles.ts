// Hardware profiles, ported from ~/src/local-claude/profile.sh.
// m4  — MacBook Pro M4 Pro 48GB: Qwen3-Coder-30B-A3B @ 128K context
// air — MacBook Air M1 16GB:     Qwen2.5-Coder-7B    @ 16K context
// Override auto-detection with SMITH_PROFILE=m4|air or --profile.

/** How much always-on system-prompt content a profile can afford. */
export type PromptTier = "full" | "lean";

export interface Profile {
  name: string;
  model: string;
  /** Model id used for auxiliary work (compaction summaries, web extraction). */
  smallModel: string;
  contextLength: number;
  temperature: number;
  topP: number;
  /** Cap on a single tool result before truncation (chars). */
  maxToolResultChars: number;
  /** Cap on agent-loop iterations per user turn. */
  maxSteps: number;
  /** Tools omitted on constrained profiles (by name). */
  disabledTools: string[];
  /** Size tier for optional system-prompt sections (stack card, guidance). */
  promptTier: PromptTier;
  /** Cap on injected AGENT.md before truncation (chars). */
  maxMemoryChars: number;
}

const PROFILES: Record<string, Profile> = {
  m4: {
    name: "m4",
    model: "qwen/qwen3-coder-30b",
    smallModel: "openai/gpt-oss-20b",
    contextLength: 131072,
    // Qwen3-Coder model-card recommended sampling
    temperature: 0.7,
    topP: 0.8,
    maxToolResultChars: 30_000,
    maxSteps: 60,
    disabledTools: [],
    promptTier: "full",
    maxMemoryChars: 6_000,
  },
  air: {
    name: "air",
    model: "qwen/qwen3.5-9b",
    smallModel: "qwen/qwen3.5-9b",
    contextLength: 16384,
    temperature: 0.2,
    topP: 0.9,
    maxToolResultChars: 4_000,
    maxSteps: 20,
    disabledTools: [],
    promptTier: "lean",
    maxMemoryChars: 2_400,
  },
};

export function detectProfileName(): string {
  const override = process.env.SMITH_PROFILE;
  if (override) return override;
  const proc = Bun.spawnSync(["sysctl", "-n", "hw.memsize"]);
  const memBytes = Number(proc.stdout.toString().trim()) || 0;
  return memBytes >= 40 * 1024 ** 3 ? "m4" : "air";
}

export function getProfile(name?: string): Profile {
  const resolved = name ?? detectProfileName();
  const profile = PROFILES[resolved];
  if (!profile) {
    throw new Error(
      `unknown profile '${resolved}' (expected: ${Object.keys(PROFILES).join(", ")})`,
    );
  }
  return profile;
}

export const LMSTUDIO_URL = process.env.SMITH_BASE_URL ?? "http://localhost:1234";
