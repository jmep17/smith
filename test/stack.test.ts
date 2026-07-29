import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frontendGuidance, greenfieldGuidance } from "../src/agent/frontend-guidance.ts";
import { detectStack, isGreenfield, renderStackCard } from "../src/agent/stack.ts";
import { buildSystemPrompt } from "../src/agent/system-prompt.ts";
import { getProfile } from "../src/provider/profiles.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-stack-"));
});

async function writeNextTailwindFixture() {
  await Bun.write(
    join(dir, "package.json"),
    JSON.stringify({
      dependencies: {
        next: "^15.1.0",
        react: "^19.0.0",
        tailwindcss: "^4.0.0",
        zustand: "^5.0.0",
        zod: "^3.24.0",
      },
      devDependencies: { typescript: "^5.7.0", vitest: "^3.0.0" },
      scripts: { dev: "next dev", build: "next build", typecheck: "tsc --noEmit" },
    }),
  );
  await Bun.write(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true } }),
  );
  await Bun.write(join(dir, "components.json"), "{}");
  await Bun.write(join(dir, "bun.lock"), "");
  await mkdir(join(dir, "app"), { recursive: true });
  await mkdir(join(dir, "src/components"), { recursive: true });
}

describe("detectStack", () => {
  test("detects a Next + Tailwind + shadcn repo", async () => {
    await writeNextTailwindFixture();
    const stack = await detectStack(dir);
    expect(stack).not.toBeNull();
    expect(stack?.framework).toBe("Next.js 15 (app router), React 19");
    expect(stack?.language).toBe("TypeScript (strict)");
    expect(stack?.styling).toBe("Tailwind v4");
    expect(stack?.componentLib).toBe("shadcn/ui");
    expect(stack?.libs).toContain("zustand");
    expect(stack?.testRunner).toBe("vitest");
    expect(stack?.packageManager).toBe("bun");
    expect(stack?.scripts.dev).toBe("next dev");
    expect(stack?.componentDirs).toContain("src/components");
    expect(stack?.isFrontend).toBe(true);
  });

  test("plain node library is not frontend", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { express: "^4.0.0" },
        scripts: { test: "bun test" },
      }),
    );
    const stack = await detectStack(dir);
    expect(stack?.isFrontend).toBe(false);
    expect(stack?.framework).toBeNull();
    expect(stack?.testRunner).toBe("bun test");
    expect(frontendGuidance(stack!, "full")).toBeNull();
  });

  test("react + ink (a TUI like smith itself) is not frontend", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { react: "^19.0.0", ink: "^7.0.0" } }),
    );
    const stack = await detectStack(dir);
    expect(stack?.isFrontend).toBe(false);
  });

  test("returns null without package.json", async () => {
    expect(await detectStack(dir)).toBeNull();
  });

  test("cache invalidates when package.json changes", async () => {
    await Bun.write(join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
    expect((await detectStack(dir))?.isFrontend).toBe(false);
    // Bump mtime with new content.
    await new Promise((r) => setTimeout(r, 10));
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { vue: "^3.5.0" } }),
    );
    expect((await detectStack(dir))?.framework).toBe("Vue 3");
  });
});

describe("renderStackCard", () => {
  test("full tier includes libs and components, lean does not", async () => {
    await writeNextTailwindFixture();
    const stack = (await detectStack(dir))!;
    const full = renderStackCard(stack, "full");
    const lean = renderStackCard(stack, "lean");
    expect(full).toContain("# Project stack");
    expect(full).toContain("zustand");
    expect(full).toContain("src/components");
    expect(lean).toContain("Next.js 15");
    expect(lean).not.toContain("zustand");
    expect(lean.length).toBeLessThan(full.length);
  });
});

describe("frontendGuidance", () => {
  test("tiered output for a frontend repo", async () => {
    await writeNextTailwindFixture();
    const stack = (await detectStack(dir))!;
    const full = frontendGuidance(stack, "full");
    const lean = frontendGuidance(stack, "lean");
    expect(full).toContain("# Frontend work");
    expect(full).toContain("use client");
    expect(full).toContain("zustand");
    expect(full).toContain("keyboard");
    expect(lean).toContain("Tailwind");
    expect(lean!.length).toBeLessThan(full!.length);
  });
});

describe("greenfield", () => {
  test("empty dir is greenfield; a Python project is not", async () => {
    expect(await isGreenfield(dir)).toBe(true);
    await Bun.write(join(dir, "pyproject.toml"), "");
    expect(await isGreenfield(dir)).toBe(false);
  });

  test("lean guidance is shorter than full", () => {
    expect(greenfieldGuidance("lean").length).toBeLessThan(
      greenfieldGuidance("full").length,
    );
  });
});

describe("buildSystemPrompt", () => {
  test("includes stack card and guidance for a frontend repo", async () => {
    await writeNextTailwindFixture();
    const prompt = await buildSystemPrompt(dir, getProfile("m4"), null);
    expect(prompt).toContain("# Project stack");
    expect(prompt).toContain("# Frontend work");
  });

  test("greenfield dir gets scaffolding guidance", async () => {
    const prompt = await buildSystemPrompt(dir, getProfile("air"), null);
    expect(prompt).toContain("# New project");
    expect(prompt).not.toContain("# Project stack");
  });

  test("AGENT.md is truncated at the profile cap", async () => {
    const air = getProfile("air");
    const memory = "x".repeat(air.maxMemoryChars + 500);
    const prompt = await buildSystemPrompt(dir, air, memory);
    expect(prompt).toContain(`[AGENT.md truncated at ${air.maxMemoryChars} chars]`);
    expect(prompt).not.toContain("x".repeat(air.maxMemoryChars + 1));
  });
});
