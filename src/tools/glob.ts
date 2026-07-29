import fg from "fast-glob";
import { z } from "zod";
import { resolvePath, type ToolDef } from "./types.ts";

const MAX_RESULTS = 100;

const schema = z.object({
  pattern: z.string().describe("Glob pattern, e.g. src/**/*.ts"),
  path: z.string().optional().describe("Directory to search (default: cwd)"),
});

export const globTool: ToolDef<typeof schema> = {
  name: "Glob",
  description:
    "Find files by glob pattern. Returns paths sorted by modification time (newest first), capped at 100.",
  schema,
  readOnly: true,
  specifier: (input) => input.pattern,
  async execute(input, ctx) {
    const cwd = input.path ? resolvePath(input.path, ctx) : ctx.cwd;
    const entries = await fg(input.pattern, {
      cwd,
      absolute: true,
      dot: false,
      onlyFiles: true,
      stats: true,
      suppressErrors: true,
      ignore: ["**/node_modules/**", "**/.git/**"],
    });
    entries.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
    const capped = entries.slice(0, MAX_RESULTS);
    if (capped.length === 0) return "No files matched.";
    const listing = capped.map((e) => e.path).join("\n");
    const note =
      entries.length > MAX_RESULTS
        ? `\n[${entries.length} matches, showing first ${MAX_RESULTS} by mtime — narrow the pattern]`
        : "";
    return listing + note;
  },
};
