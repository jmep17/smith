import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface PermissionSettings {
  allow: string[];
  deny: string[];
}

const GLOBAL_PATH = `${process.env.HOME}/.config/smith/settings.json`;

function projectPath(cwd: string): string {
  return `${cwd}/.smith/settings.json`;
}

async function loadOne(path: string): Promise<PermissionSettings> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { allow: [], deny: [] };
  try {
    const parsed = await file.json();
    return {
      allow: Array.isArray(parsed.allow) ? parsed.allow : [],
      deny: Array.isArray(parsed.deny) ? parsed.deny : [],
    };
  } catch {
    return { allow: [], deny: [] };
  }
}

/** Merged global + project rules, plus any extra rules from CLI flags. */
export async function loadSettings(
  cwd: string,
  extraAllow: string[] = [],
): Promise<PermissionSettings> {
  const [global, project] = await Promise.all([
    loadOne(GLOBAL_PATH),
    loadOne(projectPath(cwd)),
  ]);
  return {
    allow: [...global.allow, ...project.allow, ...extraAllow],
    deny: [...global.deny, ...project.deny],
  };
}

/** Persist an allow rule ("always" in the permission prompt) to the project settings. */
export async function persistAllowRule(cwd: string, rule: string): Promise<void> {
  const path = projectPath(cwd);
  const current = await loadOne(path);
  if (current.allow.includes(rule)) return;
  current.allow.push(rule);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(current, null, 2)}\n`);
}
