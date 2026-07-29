import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { resolvePath, type ToolDef } from "./types.ts";

const schema = z.object({
  file_path: z.string().describe("Path of the file to write"),
  content: z.string().describe("Full content to write (overwrites the file)"),
});

export const writeTool: ToolDef<typeof schema> = {
  name: "Write",
  description:
    "Write a file, overwriting it if it exists. For partial changes to an existing file use Edit instead.",
  schema,
  readOnly: false,
  specifier: (input) => input.file_path,
  async execute(input, ctx) {
    const path = resolvePath(input.file_path, ctx);
    const exists = await Bun.file(path).exists();
    if (exists && !ctx.readFiles.has(path)) {
      throw new Error(
        `refusing to overwrite ${path}: Read it first so you know what you are replacing.`,
      );
    }
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, input.content);
    ctx.readFiles.add(path);
    const lineCount = input.content.split("\n").length;
    return `${exists ? "Updated" : "Created"} ${path} (${lineCount} lines)`;
  },
};
