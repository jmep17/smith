import { z } from "zod";
import type { ToolDef } from "./types.ts";

const schema = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().describe("Short imperative description"),
        status: z.enum(["pending", "in_progress", "completed"]),
      }),
    )
    .describe("The full todo list (replaces the previous list)"),
});

const MARKS = { pending: "[ ]", in_progress: "[~]", completed: "[x]" } as const;

export const taskTool: ToolDef<typeof schema> = {
  name: "TaskWrite",
  description:
    "Track progress on multi-step work with a todo list. Pass the complete updated list each time. Use for tasks with 3+ distinct steps.",
  schema,
  readOnly: true,
  specifier: (input) => `${input.todos.length} todos`,
  async execute(input, ctx) {
    ctx.todos = input.todos;
    return input.todos.map((t) => `${MARKS[t.status]} ${t.content}`).join("\n");
  },
};
