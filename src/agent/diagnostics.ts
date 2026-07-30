import { stat } from "node:fs/promises";
import type { ToolContext } from "../tools/types.ts";
import { detectStack, type StackInfo } from "./stack.ts";

const CHECKABLE_EXTENSIONS = [".ts", ".tsx", ".jsx", ".vue", ".svelte"];
const DEBOUNCE_MS = 10_000;
const TYPECHECK_TIMEOUT_MS = 45_000;
const MAX_ERROR_CHARS = 1_600;
/** Tailwind arbitrary values: bg-[#6C5CE7], px-[13px], w-[3.5rem], … */
const ARBITRARY_VALUE = /\[(#[0-9a-fA-F]{3,8}|\d+(?:\.\d+)?(?:px|rem|em|vh|vw))\]/g;
const DEV_SERVER_PORTS = [3000, 5173, 8080, 4321];

export function isCheckableFile(path: string): boolean {
  return CHECKABLE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Command to typecheck the project. Only ever runs tsc: a package.json script
 * is used solely when its command starts with `tsc` — Edit/Write permission
 * does not extend to silently executing arbitrary project scripts.
 */
export async function typecheckCommand(
  stack: StackInfo,
  cwd: string,
): Promise<string[] | null> {
  for (const name of ["typecheck", "check"]) {
    const cmd = stack.scripts[name];
    if (cmd && /^tsc(\s|$)/.test(cmd)) return [stack.packageManager, "run", name];
  }
  const localTsc = `${cwd}/node_modules/.bin/tsc`;
  try {
    await stat(localTsc);
    return [localTsc, "--noEmit"];
  } catch {
    return null;
  }
}

async function runTypecheck(cmd: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), TYPECHECK_TIMEOUT_MS);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    if (exitCode === 0) return "✓ typecheck passed";
    const output = `${stdout}\n${stderr}`.trim();
    if (!output) return null; // killed on timeout or died silently — say nothing
    const trimmed =
      output.length > MAX_ERROR_CHARS
        ? `${output.slice(0, MAX_ERROR_CHARS)}\n[more errors truncated]`
        : output;
    return `TYPECHECK ERRORS (fix these before finishing):\n${trimmed}`;
  } catch {
    return null;
  }
}

async function tokenLint(filePath: string, stack: StackInfo): Promise<string | null> {
  if (!stack.styling?.includes("Tailwind")) return null;
  let content: string;
  try {
    content = await Bun.file(filePath).text();
  } catch {
    return null;
  }
  const matches = [...content.matchAll(ARBITRARY_VALUE)].map((m) => m[0]);
  if (matches.length === 0) return null;
  const shown = [...new Set(matches)].slice(0, 3).join(", ");
  return `DESIGN TOKENS: this repo uses a design system; found arbitrary values (${shown}). Prefer the project's token classes.`;
}

/**
 * Ground-truth feedback after an Edit/Write to a code file: typecheck output
 * and design-token warnings, appended to the tool result so the model sees
 * compiler reality immediately. Returns null when there is nothing to say.
 */
export async function runPostEditChecks(
  filePath: string,
  ctx: ToolContext,
): Promise<string | null> {
  if (!ctx.profile.postEditChecks || !isCheckableFile(filePath)) return null;
  const now = Date.now();
  if (now - ctx.lastDiagnosticsAt < DEBOUNCE_MS) return null;
  ctx.lastDiagnosticsAt = now;

  const stack = await detectStack(ctx.cwd);
  if (!stack) return null;

  const sections: string[] = [];
  const cmd = await typecheckCommand(stack, ctx.cwd);
  if (cmd) {
    const result = await runTypecheck(cmd, ctx.cwd);
    if (result) sections.push(result);
  }
  const lint = await tokenLint(filePath, stack);
  if (lint) sections.push(lint);
  return sections.length > 0 ? sections.join("\n") : null;
}

/** Probe common dev-server ports; returns the first responding port. */
export async function detectDevServer(
  ports: number[] = DEV_SERVER_PORTS,
): Promise<number | null> {
  const probes = ports.map(async (port) => {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(250) });
    return port; // any HTTP response, whatever the status, means something is serving
  });
  return Promise.any(probes).catch(() => null);
}
