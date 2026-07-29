import { rgPath } from "@vscode/ripgrep";
import { z } from "zod";
import { resolvePath, type ToolDef } from "./types.ts";

const MAX_OUTPUT = 20_000;

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

    const proc = Bun.spawn([rgPath, ...args], {
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
