import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockupGuidance, wantsMockup } from "../src/agent/mockup-guidance.ts";
import { detectStack } from "../src/agent/stack.ts";
import { buildSystemPrompt } from "../src/agent/system-prompt.ts";
import { getProfile } from "../src/provider/profiles.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-mockup-"));
});

describe("wantsMockup", () => {
  test("triggers on mockup/wireframe/prototype requests", () => {
    expect(wantsMockup("Mock up a dashboard for the sales team")).toBe(true);
    expect(wantsMockup("create a mockup of the landing page")).toBe(true);
    expect(wantsMockup("give me some wireframes for onboarding")).toBe(true);
    expect(wantsMockup("build an interactive prototype")).toBe(true);
    expect(wantsMockup("a clickable mock-up please")).toBe(true);
  });

  test("does not trigger on test mocking or plain requests", () => {
    expect(wantsMockup("mock the API in the tests")).toBe(false);
    expect(wantsMockup("we're mocking fetch with vitest")).toBe(false);
    expect(wantsMockup("fix the login bug")).toBe(false);
  });
});

describe("mockupGuidance", () => {
  test("lean is shorter than full; works without a stack", () => {
    const full = mockupGuidance(null, "full");
    const lean = mockupGuidance(null, "lean");
    expect(full).toContain("# Mockups & wireframes");
    expect(full).toContain("mockups/");
    expect(full).toContain("hash");
    expect(lean).toContain("mockups/");
    expect(lean.length).toBeLessThan(full.length);
  });

  test("design-system bullet appears only when the stack has styling", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { react: "^19.0.0", tailwindcss: "^4.0.0" } }),
    );
    const styled = (await detectStack(dir))!;
    expect(mockupGuidance(styled, "full")).toContain("design system");
    expect(mockupGuidance(null, "full")).not.toContain("design system");
  });
});

describe("buildSystemPrompt mockup mode", () => {
  test("empty dir with mockups on: mockup section replaces greenfield", async () => {
    const prompt = await buildSystemPrompt(dir, getProfile("m4"), null, {
      mockups: true,
    });
    expect(prompt).toContain("# Mockups & wireframes");
    expect(prompt).not.toContain("# New project");
  });

  test("empty dir without mockups keeps greenfield and no mockup section", async () => {
    const prompt = await buildSystemPrompt(dir, getProfile("m4"), null);
    expect(prompt).toContain("# New project");
    expect(prompt).not.toContain("# Mockups");
  });

  test("frontend repo with mockups on keeps frontend guidance too", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { react: "^19.0.0", tailwindcss: "^4.0.0" } }),
    );
    const prompt = await buildSystemPrompt(dir, getProfile("air"), null, {
      mockups: true,
    });
    expect(prompt).toContain("# Frontend work");
    expect(prompt).toContain("# Mockups & wireframes");
  });
});
