import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { componentInventory, generateAgentMd, runInit } from "../src/agent/init.ts";
import { referenceIndex } from "../src/agent/skills.ts";
import { detectStack } from "../src/agent/stack.ts";
import { buildSystemPrompt } from "../src/agent/system-prompt.ts";
import { getProfile } from "../src/provider/profiles.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-init-"));
});

async function writeFrontendFixture() {
  await Bun.write(
    join(dir, "package.json"),
    JSON.stringify({
      dependencies: { next: "^15.0.0", react: "^19.0.0", tailwindcss: "^4.0.0" },
      scripts: { dev: "next dev", typecheck: "tsc --noEmit" },
    }),
  );
  await mkdir(join(dir, "app"), { recursive: true });
  await Bun.write(
    join(dir, "app/globals.css"),
    `@theme {\n  --color-brand: #6c5ce7;\n  --radius-card: 0.75rem;\n}\n:root { --spacing-page: 2rem; }`,
  );
  await mkdir(join(dir, "src/components"), { recursive: true });
  await Bun.write(
    join(dir, "src/components/Button.tsx"),
    `export function Button() { return null; }\nexport const IconButton = () => null;`,
  );
}

describe("design tokens", () => {
  test("extracted from @theme and :root into the stack", async () => {
    await writeFrontendFixture();
    const stack = (await detectStack(dir))!;
    expect(stack.designTokens).toContain("--color-brand: #6c5ce7");
    expect(stack.designTokens).toContain("--spacing-page: 2rem");
  });
});

describe("componentInventory", () => {
  test("lists exported PascalCase components with paths", async () => {
    await writeFrontendFixture();
    const inv = await componentInventory(dir, ["src/components"]);
    expect(inv).toHaveLength(1);
    expect(inv[0]?.name).toBe("Button, IconButton");
    expect(inv[0]?.path).toBe("src/components/Button.tsx");
  });
});

describe("generateAgentMd / runInit", () => {
  test("fills stack, commands, tokens, components, conventions", async () => {
    await writeFrontendFixture();
    const md = await generateAgentMd(dir);
    expect(md).toContain("## Stack");
    expect(md).toContain("Next.js 15");
    expect(md).toContain("## Commands");
    expect(md).toContain("--color-brand");
    expect(md).toContain("Button, IconButton — src/components/Button.tsx");
    expect(md).toContain("## Conventions");
  });

  test("non-JS dir still gets a conventions template", async () => {
    const md = await generateAgentMd(dir);
    expect(md).toContain("# AGENT.md");
    expect(md).toContain("## Conventions");
    expect(md).not.toContain("## Stack");
  });

  test("runInit writes once and refuses to overwrite", async () => {
    await writeFrontendFixture();
    const path = await runInit(dir);
    expect(await Bun.file(path).exists()).toBe(true);
    expect(runInit(dir)).rejects.toThrow("already exists");
  });
});

describe("referenceIndex", () => {
  test("materializes matching cheat-sheets and lists repo playbooks", async () => {
    await writeFrontendFixture();
    const stack = (await detectStack(dir))!;
    await mkdir(join(dir, ".smith/skills"), { recursive: true });
    await Bun.write(join(dir, ".smith/skills/forms.md"), "# forms");

    const full = await referenceIndex(dir, stack, "full");
    expect(full).toContain("# Reference material");
    expect(full).toContain("tailwind-v4.md");
    expect(full).toContain("react-19.md");
    expect(full).toContain("nextjs-15.md");
    expect(full).toContain(".smith/skills/forms.md");
    // Sheets exist on disk for the Read tool.
    const sheetPath = full?.split("\n").find((l) => l.includes("tailwind-v4.md"));
    const path = sheetPath?.replace(/^- /, "").split(" — ")[0];
    expect(await Bun.file(path as string).exists()).toBe(true);
    expect(await Bun.file(path as string).text()).toContain("CSS-first");

    const lean = await referenceIndex(dir, stack, "lean");
    expect(lean?.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(2);
  });

  test("null when nothing applies", async () => {
    await Bun.write(join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
    const stack = await detectStack(dir);
    expect(await referenceIndex(dir, stack, "full")).toBeNull();
  });
});

describe("buildSystemPrompt reference index", () => {
  test("frontend repo lists reference material", async () => {
    await writeFrontendFixture();
    const prompt = await buildSystemPrompt(dir, getProfile("m4"), null);
    expect(prompt).toContain("# Reference material");
    expect(prompt).toContain("design tokens: --color-brand");
  });
});
