import type { Profile } from "../provider/profiles.ts";
import { frontendGuidance, greenfieldGuidance } from "./frontend-guidance.ts";
import { detectStack, isGreenfield, renderStackCard } from "./stack.ts";

async function gitStatus(cwd: string): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "-C", cwd, "status", "--porcelain", "--branch"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return "not a git repository";
    const lines = out.trim().split("\n");
    const branch = lines[0]?.replace("## ", "") ?? "?";
    const dirty = lines.length - 1;
    return `branch ${branch}, ${dirty} changed file${dirty === 1 ? "" : "s"}`;
  } catch {
    return "not a git repository";
  }
}

export async function buildSystemPrompt(
  cwd: string,
  profile: Profile,
  memory: string | null,
): Promise<string> {
  const [git, stack] = await Promise.all([gitStatus(cwd), detectStack(cwd)]);
  const base = `You are smith, a coding agent running in a terminal. You help with software engineering: exploring code, fixing bugs, writing features, running commands, and writing documentation.

# How to work
- Use the provided tools to act. Do not describe what you would do — do it.
- Read files before editing them. Prefer Edit over Write for existing files.
- Keep responses short. After finishing a task, summarize what you did in 1-3 sentences.
- When a tool returns an error, read the error and correct your call — do not repeat it unchanged.
- Call one tool at a time and wait for the result.
- Verify your work when possible (run the code, run tests, re-read the file).
- Never invent file contents or command output; if you have not read it, read it.

# Environment
- cwd: ${cwd}
- platform: macOS (Apple Silicon)
- date: ${new Date().toISOString().slice(0, 10)}
- git: ${git}`;

  const parts = [base];
  if (stack) parts.push(renderStackCard(stack, profile.promptTier));
  if (memory) {
    const cap = profile.maxMemoryChars;
    const capped =
      memory.length > cap
        ? `${memory.slice(0, cap)}\n[AGENT.md truncated at ${cap} chars]`
        : memory;
    parts.push(`# Project notes (AGENT.md)\n${capped}`);
  }
  if (stack) {
    const guidance = frontendGuidance(stack, profile.promptTier);
    if (guidance) parts.push(guidance);
  } else if (await isGreenfield(cwd)) {
    parts.push(greenfieldGuidance(profile.promptTier));
  }
  return parts.join("\n\n");
}

export async function loadMemory(cwd: string): Promise<string | null> {
  const file = Bun.file(`${cwd}/AGENT.md`);
  if (!(await file.exists())) return null;
  const text = (await file.text()).trim();
  return text || null;
}
