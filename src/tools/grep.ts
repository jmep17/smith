import { z } from "zod";
import { resolvePath, type ToolDef } from "./types.ts";

const MAX_OUTPUT = 20_000;

let cachedRg: string | null = null;

/**
 * Locate ripgrep lazily. @vscode/ripgrep resolves its platform binary on
 * disk at import time, which crashes inside a compiled single-file binary
 * ($bunfs has no bin/rg) — so prefer a system rg and only fall back to the
 * package when running from source.
 */
async function findRg(): Promise<string> {
  if (cachedRg) return cachedRg;
  const system = Bun.which("rg");
  if (system) {
    cachedRg = system;
    return system;
  }
  try {
    const { rgPath } = await import("@vscode/ripgrep");
    if (await Bun.file(rgPath).exists()) {
      cachedRg = rgPath;
      return rgPath;
    }
  } catch {
    // not resolvable here (compiled binary) — fall through
  }
  throw new Error(
    "ripgrep not found — install it (e.g. `brew install ripgrep`) to use Grep.",
  );
}

const schema = z.object({
  pattern: z.string().describe("Regular expression to search for (ripgrep syntax)"),
  path: z.string().optional().describe("File or directory to search (default: cwd)"),
  glob: z.string().optional().describe("Filter files by glob, e.g. *.ts"),
  output_mode: z
    .enum(["files_with_matches", "content", "count"])
    .optional()
    .describe("files_with_matches (default) | content (matching lines) | count"),
  "-i": z.boolean().optional().describe("Case-insensitive search"),
});

export const grepTool: ToolDef<typeof schema> = {
  name: "Grep",
  description:
    "Search file contents with ripgrep. Respects .gitignore. Default lists matching files; use output_mode 'content' to see matching lines with line numbers.",
  schema,
  readOnly: true,
  specifier: (input) => input.pattern,
  async execute(input, ctx) {
    const mode = input.output_mode ?? "files_with_matches";
    const args: string[] = ["--no-require-git", "--hidden", "--glob", "!.git/**"];
    if (mode === "files_with_matches") args.push("-l");
    if (mode === "count") args.push("-c");
    if (mode === "content") args.push("-n");
    if (input["-i"]) args.push("-i");
    if (input.glob) args.push("--glob", input.glob);
    args.push("-e", input.pattern);
    args.push(input.path ? resolvePath(input.path, ctx) : ctx.cwd);

    const proc = Bun.spawn([await findRg(), ...args], {
      cwd: ctx.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode === 1) return "No matches.";
    if (exitCode !== 0) throw new Error(`ripgrep failed: ${stderr.trim()}`);
    return stdout.length > MAX_OUTPUT
      ? `${stdout.slice(0, MAX_OUTPUT)}\n[truncated — narrow the search]`
      : stdout.trimEnd();
  },
};
