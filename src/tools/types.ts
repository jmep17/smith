import type { z } from "zod";
import type { Profile } from "../provider/profiles.ts";

export interface ToolContext {
  cwd: string;
  /** Absolute paths the model has Read this session (read-before-edit gate). */
  readFiles: Set<string>;
  profile: Profile;
  /** Directory for oversized outputs spilled to disk. */
  spillDir: string;
  /** Updated by Bash when a command ends in a different directory. */
  setCwd: (dir: string) => void;
  /** Session todo list, owned by the TaskWrite tool. */
  todos: { content: string; status: string }[];
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** True → never needs permission (Read/Glob/Grep). */
  readOnly: boolean;
  /** Specifier used in permission rules, e.g. the command for Bash, the path for Edit. */
  specifier: (input: z.infer<S>) => string;
  execute: (input: z.infer<S>, ctx: ToolContext) => Promise<string>;
}

/** Resolve a possibly-relative path against the session cwd. */
export function resolvePath(p: string, ctx: ToolContext): string {
  if (p.startsWith("~/")) p = `${process.env.HOME}/${p.slice(2)}`;
  return p.startsWith("/") ? p : `${ctx.cwd}/${p}`;
}
