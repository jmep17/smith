import { readdir } from "node:fs/promises";
import { detectStack, renderStackCard } from "./stack.ts";

const COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".vue", ".svelte"];
const MAX_INVENTORY = 40;
const EXPORT_NAME = /export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z]\w*)/g;

export interface ComponentEntry {
  name: string;
  path: string;
}

/** One line per component: exported PascalCase names found in the component dirs. */
export async function componentInventory(
  cwd: string,
  dirs: string[],
): Promise<ComponentEntry[]> {
  const entries: ComponentEntry[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = (await readdir(`${cwd}/${dir}`, { recursive: true })) as string[];
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      if (!COMPONENT_EXTENSIONS.some((ext) => file.endsWith(ext))) continue;
      if (entries.length >= MAX_INVENTORY) return entries;
      try {
        const content = await Bun.file(`${cwd}/${dir}/${file}`).text();
        const names = [...content.matchAll(EXPORT_NAME)].map((m) => m[1]);
        if (names.length > 0)
          entries.push({
            name: [...new Set(names)].join(", ") as string,
            path: `${dir}/${file}`,
          });
      } catch {
        // unreadable file — skip
      }
    }
  }
  return entries;
}

/** Template-driven AGENT.md content: deterministic detection fills the facts. */
export async function generateAgentMd(cwd: string): Promise<string> {
  const stack = await detectStack(cwd);
  const sections: string[] = [
    "# AGENT.md",
    "Project notes for smith. This file is injected into every turn's system prompt — keep it short and current.",
  ];

  if (stack) {
    sections.push(
      `## Stack\n${renderStackCard(stack, "full").split("\n").slice(1).join("\n")}`,
    );
    const commands = Object.entries(stack.scripts)
      .map(([name, cmd]) => `- \`${stack.packageManager} run ${name}\` — ${cmd}`)
      .join("\n");
    if (commands) sections.push(`## Commands\n${commands}`);
    if (stack.designTokens.length > 0) {
      sections.push(
        `## Design tokens\n${stack.designTokens.map((t) => `- \`${t}\``).join("\n")}`,
      );
    }
    const inventory = await componentInventory(cwd, stack.componentDirs);
    if (inventory.length > 0) {
      const lines = inventory.map((c) => `- ${c.name} — ${c.path}`);
      if (inventory.length >= MAX_INVENTORY)
        lines.push(`- … (truncated at ${MAX_INVENTORY})`);
      sections.push(
        `## Components (reuse these before writing new ones)\n${lines.join("\n")}`,
      );
    }
  }

  sections.push(
    `## Conventions (edit me)\n- How components are named and where new ones go.\n- Anything the agent keeps getting wrong in this repo.`,
  );
  return `${sections.join("\n\n")}\n`;
}

/** Write AGENT.md for the cwd; refuses to overwrite an existing file. */
export async function runInit(cwd: string): Promise<string> {
  const path = `${cwd}/AGENT.md`;
  if (await Bun.file(path).exists()) {
    throw new Error("AGENT.md already exists — edit it directly or delete it first.");
  }
  await Bun.write(path, await generateAgentMd(cwd));
  return path;
}
