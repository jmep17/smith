import { stat } from "node:fs/promises";
import type { PromptTier } from "../provider/profiles.ts";

export interface StackInfo {
  /** e.g. "Next.js 15 (app router)" or "React 19 (Vite)". */
  framework: string | null;
  /** e.g. "TypeScript (strict)", "TypeScript", "JavaScript". */
  language: string;
  /** e.g. "Tailwind v4". */
  styling: string | null;
  /** e.g. "shadcn/ui", "MUI". */
  componentLib: string | null;
  /** Notable state/form/validation libraries. */
  libs: string[];
  testRunner: string | null;
  packageManager: string;
  /** Subset of package.json scripts worth surfacing (dev, build, typecheck, …). */
  scripts: Record<string, string>;
  /** Existing component directories, relative to the repo root. */
  componentDirs: string[];
  /** True when this looks like a browser frontend (not a TUI or plain library). */
  isFrontend: boolean;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const SURFACED_SCRIPTS = ["dev", "start", "build", "test", "typecheck", "check", "lint"];
const COMPONENT_DIRS = [
  "src/components",
  "components",
  "app/components",
  "src/lib/components",
];
/** Markers of an established non-JS project; suppress greenfield guidance when present. */
const OTHER_PROJECT_MARKERS = [
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
];

const cache = new Map<string, { mtimeMs: number; stack: StackInfo }>();

function major(range: string | undefined): string | null {
  const m = range?.match(/\d+/);
  return m ? m[0] : null;
}

function withVersion(name: string, range: string | undefined): string {
  const v = major(range);
  return v ? `${name} ${v}` : name;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function anyExists(cwd: string, paths: string[]): Promise<string | null> {
  for (const p of paths) {
    if (await exists(`${cwd}/${p}`)) return p;
  }
  return null;
}

async function detect(cwd: string, pkg: PackageJson): Promise<StackInfo> {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (name: string) => name in deps;

  let framework: string | null = null;
  let browserFramework = false;
  if (has("next")) {
    const appRouter = (await anyExists(cwd, ["app", "src/app"])) !== null;
    framework = `${withVersion("Next.js", deps.next)}${appRouter ? " (app router)" : " (pages router)"}, ${withVersion("React", deps.react)}`;
    browserFramework = true;
  } else if (has("nuxt")) {
    framework = `${withVersion("Nuxt", deps.nuxt)}, ${withVersion("Vue", deps.vue)}`;
    browserFramework = true;
  } else if (has("@sveltejs/kit")) {
    framework = `${withVersion("SvelteKit", deps["@sveltejs/kit"])}, ${withVersion("Svelte", deps.svelte)}`;
    browserFramework = true;
  } else if (has("svelte")) {
    framework = withVersion("Svelte", deps.svelte);
    browserFramework = true;
  } else if (has("astro")) {
    framework = withVersion("Astro", deps.astro);
    browserFramework = true;
  } else if (has("vue")) {
    framework = withVersion("Vue", deps.vue);
    browserFramework = true;
  } else if (has("solid-js")) {
    framework = withVersion("Solid", deps["solid-js"]);
    browserFramework = true;
  } else if (has("react")) {
    framework = withVersion("React", deps.react);
    if (has("vite")) framework += " (Vite)";
  }

  const hasTs = has("typescript") || (await exists(`${cwd}/tsconfig.json`));
  let language = hasTs ? "TypeScript" : "JavaScript";
  if (hasTs) {
    try {
      const tsconfig = await Bun.file(`${cwd}/tsconfig.json`).text();
      if (/"strict"\s*:\s*true/.test(tsconfig)) language = "TypeScript (strict)";
    } catch {
      // unreadable tsconfig — leave as plain "TypeScript"
    }
  }

  let styling: string | null = null;
  if (has("tailwindcss"))
    styling = withVersion("Tailwind", deps.tailwindcss).replace(" ", " v");
  else if (has("styled-components")) styling = "styled-components";
  else if (has("@emotion/react")) styling = "Emotion";

  let componentLib: string | null = null;
  if (await exists(`${cwd}/components.json`)) componentLib = "shadcn/ui";
  else if (has("@mui/material")) componentLib = "MUI";
  else if (has("@chakra-ui/react")) componentLib = "Chakra UI";
  else if (Object.keys(deps).some((d) => d.startsWith("@radix-ui/")))
    componentLib = "Radix UI";

  const libs: string[] = [];
  for (const lib of [
    "zustand",
    "@reduxjs/toolkit",
    "redux",
    "jotai",
    "pinia",
    "@tanstack/react-query",
    "react-hook-form",
    "zod",
  ]) {
    if (has(lib)) libs.push(lib);
  }

  let testRunner: string | null = null;
  if (has("vitest")) testRunner = "vitest";
  else if (has("jest")) testRunner = "jest";
  else if (pkg.scripts?.test?.includes("bun test")) testRunner = "bun test";
  if (has("@playwright/test"))
    testRunner = testRunner ? `${testRunner} + playwright` : "playwright";

  let packageManager = "npm";
  if ((await exists(`${cwd}/bun.lock`)) || (await exists(`${cwd}/bun.lockb`)))
    packageManager = "bun";
  else if (await exists(`${cwd}/pnpm-lock.yaml`)) packageManager = "pnpm";
  else if (await exists(`${cwd}/yarn.lock`)) packageManager = "yarn";

  const scripts: Record<string, string> = {};
  for (const name of SURFACED_SCRIPTS) {
    const cmd = pkg.scripts?.[name];
    if (cmd) scripts[name] = cmd;
  }

  const componentDirs: string[] = [];
  for (const dir of COMPONENT_DIRS) {
    if (await exists(`${cwd}/${dir}`)) componentDirs.push(dir);
  }

  // ink means terminal UI: react alone is not a browser frontend signal there.
  const tui = has("ink");
  const isFrontend = browserFramework || styling !== null || (has("react") && !tui);

  return {
    framework,
    language,
    styling,
    componentLib,
    libs,
    testRunner,
    packageManager,
    scripts,
    componentDirs,
    isFrontend,
  };
}

/** Detect the project stack from package.json + config files. Null when not a JS/TS project. */
export async function detectStack(cwd: string): Promise<StackInfo | null> {
  const pkgPath = `${cwd}/package.json`;
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(pkgPath)).mtimeMs;
  } catch {
    return null;
  }
  const cached = cache.get(cwd);
  if (cached && cached.mtimeMs === mtimeMs) return cached.stack;

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(await Bun.file(pkgPath).text());
  } catch {
    return null;
  }
  const stack = await detect(cwd, pkg);
  cache.set(cwd, { mtimeMs, stack });
  return stack;
}

/** True when the directory has no recognizable project of any language yet. */
export async function isGreenfield(cwd: string): Promise<boolean> {
  if (await exists(`${cwd}/package.json`)) return false;
  return (await anyExists(cwd, OTHER_PROJECT_MARKERS)) === null;
}

/** Render the "# Project stack" system-prompt section. */
export function renderStackCard(stack: StackInfo, tier: PromptTier): string {
  const lines: string[] = [];
  const frameworkLine = [stack.framework, stack.language].filter(Boolean).join(", ");
  if (frameworkLine) lines.push(`- framework: ${frameworkLine}`);
  if (stack.styling || stack.componentLib) {
    lines.push(
      `- styling: ${[stack.styling, stack.componentLib].filter(Boolean).join(" + ")}`,
    );
  }
  const scripts = Object.entries(stack.scripts)
    .map(([name, cmd]) => `${name}=\`${cmd}\``)
    .join(", ");
  if (scripts) lines.push(`- scripts: ${scripts}`);
  lines.push(`- package manager: ${stack.packageManager}`);
  if (tier === "full") {
    if (stack.libs.length > 0) lines.push(`- libs: ${stack.libs.join(", ")}`);
    if (stack.testRunner) lines.push(`- tests: ${stack.testRunner}`);
    if (stack.componentDirs.length > 0)
      lines.push(`- components: ${stack.componentDirs.join(", ")}`);
  }
  return `# Project stack\n${lines.join("\n")}`;
}
