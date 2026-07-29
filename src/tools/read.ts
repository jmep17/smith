import { z } from "zod";
import { resolvePath, type ToolDef } from "./types.ts";

const MAX_LINES = 2000;
const MAX_LINE_CHARS = 2000;

const schema = z.object({
  file_path: z.string().describe("Path to the file to read"),
  offset: z.number().optional().describe("1-based line number to start from"),
  limit: z.number().optional().describe("Maximum number of lines to read"),
});

export const readTool: ToolDef<typeof schema> = {
  name: "Read",
  description: "Read a file. Returns numbered lines. Use offset/limit for large files.",
  schema,
  readOnly: true,
  specifier: (input) => input.file_path,
  async execute(input, ctx) {
    const path = resolvePath(input.file_path, ctx);
    const file = Bun.file(path);
    if (!(await file.exists())) {
      const stat = await import("node:fs/promises").then((fs) =>
        fs.stat(path).catch(() => null),
      );
      if (stat?.isDirectory()) {
        throw new Error(`${path} is a directory, not a file. Use Glob to list it.`);
      }
      throw new Error(`file not found: ${path}`);
    }
    const text = await file.text();
    const lines = text.split("\n");
    const offset = Math.max(1, input.offset ?? 1);
    const limit = Math.min(input.limit ?? MAX_LINES, MAX_LINES);
    const slice = lines.slice(offset - 1, offset - 1 + limit);

    ctx.readFiles.add(path);

    const numbered = slice
      .map((line, i) => {
        const clipped =
          line.length > MAX_LINE_CHARS
            ? `${line.slice(0, MAX_LINE_CHARS)}… [line truncated]`
            : line;
        return `${String(offset + i).padStart(6)}\t${clipped}`;
      })
      .join("\n");

    const shownEnd = offset - 1 + slice.length;
    const partial =
      lines.length > shownEnd || offset > 1
        ? `\n[PARTIAL view: lines ${offset}-${shownEnd} of ${lines.length}. Use offset/limit to see more.]`
        : "";
    return (numbered || "[empty file]") + partial;
  },
};
