import { z } from "zod";
import { resolvePath, type ToolDef } from "./types.ts";

const schema = z.object({
  file_path: z.string().describe("Path of the file to edit"),
  old_string: z.string().describe("Exact text to replace (must match uniquely)"),
  new_string: z.string().describe("Replacement text"),
  replace_all: z
    .boolean()
    .optional()
    .describe("Replace every occurrence (default: false, old_string must be unique)"),
});

export const editTool: ToolDef<typeof schema> = {
  name: "Edit",
  description:
    "Replace an exact string in a file. old_string must match the file contents exactly (whitespace included) and be unique unless replace_all is true. Read the file first.",
  schema,
  readOnly: false,
  specifier: (input) => input.file_path,
  async execute(input, ctx) {
    const path = resolvePath(input.file_path, ctx);
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`file not found: ${path}`);
    if (!ctx.readFiles.has(path)) {
      throw new Error(`Read ${path} before editing it.`);
    }
    if (input.old_string === input.new_string) {
      throw new Error("old_string and new_string are identical.");
    }
    const text = await file.text();
    const count = text.split(input.old_string).length - 1;
    if (count === 0) {
      throw new Error(
        "old_string not found in file. Match the file contents exactly, including indentation. Re-Read the file if unsure.",
      );
    }
    if (count > 1 && !input.replace_all) {
      throw new Error(
        `old_string matches ${count} times; it must be unique. Add surrounding context or set replace_all: true.`,
      );
    }
    const updated = input.replace_all
      ? text.split(input.old_string).join(input.new_string)
      : text.replace(input.old_string, input.new_string);
    await Bun.write(path, updated);
    return `Edited ${path} (${input.replace_all ? count : 1} replacement${count > 1 && input.replace_all ? "s" : ""})`;
  },
};
