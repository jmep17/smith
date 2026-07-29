import type { Profile } from "../provider/profiles.ts";
import { bashTool } from "./bash.ts";
import { editTool } from "./edit.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { readTool } from "./read.ts";
import { taskTool } from "./task.ts";
import type { ToolDef } from "./types.ts";
import { webFetchTool } from "./webfetch.ts";
import { webSearchTool } from "./websearch.ts";
import { writeTool } from "./write.ts";

const ALL_TOOLS: ToolDef[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  globTool,
  grepTool,
  webFetchTool,
  webSearchTool,
  taskTool,
];

export function toolsForProfile(profile: Profile): Map<string, ToolDef> {
  const map = new Map<string, ToolDef>();
  for (const tool of ALL_TOOLS) {
    if (!profile.disabledTools.includes(tool.name)) map.set(tool.name, tool);
  }
  return map;
}
