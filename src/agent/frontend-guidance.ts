import type { PromptTier } from "../provider/profiles.ts";
import type { StackInfo } from "./stack.ts";

function frameworkBullets(stack: StackInfo): string[] {
  const f = stack.framework ?? "";
  const bullets: string[] = [];
  if (f.includes("Next.js") && f.includes("app router")) {
    bullets.push(
      "Follow app-router conventions: components are server components by default; add 'use client' only when the component needs state, effects, or browser APIs.",
    );
  } else if (f.includes("Vue") || f.includes("Nuxt")) {
    bullets.push(
      "Use the Composition API with <script setup>; match how existing components are written.",
    );
  } else if (f.includes("Svelte")) {
    bullets.push(
      "Match the Svelte idioms already in the repo (runes vs stores, page/layout structure).",
    );
  }
  return bullets;
}

function stateBullet(stack: StackInfo): string | null {
  if (stack.libs.includes("zustand"))
    return "Global state lives in zustand stores — extend an existing store before adding component-level state that others need.";
  if (stack.libs.includes("@reduxjs/toolkit") || stack.libs.includes("redux"))
    return "Global state uses Redux — add slices/selectors in the existing pattern; do not introduce another state library.";
  if (stack.libs.includes("jotai"))
    return "Global state uses jotai atoms — follow the existing atom organization.";
  if (stack.libs.includes("pinia"))
    return "Global state uses Pinia stores — follow the existing store organization.";
  return null;
}

/**
 * Senior-frontend-dev priors, conditioned on the detected stack.
 * Null when the project is not a browser frontend.
 */
export function frontendGuidance(stack: StackInfo, tier: PromptTier): string | null {
  if (!stack.isFrontend) return null;

  const componentDir = stack.componentDirs[0] ?? "the components directory";
  const tailwind = stack.styling?.includes("Tailwind") ?? false;

  if (tier === "lean") {
    const bullets = [
      `Before creating a component, Read one similar file in ${componentDir} and match its style exactly.`,
      "Reuse existing components; never re-implement one that already exists.",
      tailwind
        ? "Use the project's Tailwind token classes; no arbitrary values like `bg-[#hex]` or `px-[13px]`."
        : "Follow the project's existing styling approach; no hardcoded colors or magic pixel values.",
      "Use semantic HTML; interactive elements need labels and keyboard support.",
      "Style mobile-first; verify layouts at narrow widths.",
      "Done means: typecheck passes, exemplar matched, accessible, no hardcoded style values.",
    ];
    return `# Frontend work\n${bullets.map((b) => `- ${b}`).join("\n")}`;
  }

  const bullets = [
    `Before creating a new component, Glob ${componentDir} and Read one similar existing component; match its structure, imports, prop typing, and styling approach exactly. New code should be indistinguishable from the house style.`,
    "Search for an existing component before writing a new one — re-implementing something that already exists is a bug, not a feature.",
    "Follow the repo's component conventions: file naming, placement, and export style should match the neighbors; type all props explicitly.",
    ...frameworkBullets(stack),
    tailwind
      ? "Styling: use the project's Tailwind token classes (colors, spacing, radius, fonts). Arbitrary values like `bg-[#6C5CE7]` or `px-[13px]` are design-system violations — find the token instead."
      : "Styling: follow the approach already used in the repo. Do not hardcode colors or magic pixel values when the project defines variables or tokens for them.",
    ...(stateBullet(stack) ? [stateBullet(stack) as string] : []),
    "Accessibility is not optional: use semantic elements (button, nav, label, headings in order); every interactive element must be reachable and operable by keyboard; form controls need associated labels; images need alt text.",
    "Build responsive-first: start from the narrow layout, use flexible units and the project's breakpoints, and avoid fixed widths that break on small screens.",
  ];
  const checklist = [
    "typecheck (and lint, if configured) passes",
    "an existing component was reused, or a similar one was read and matched",
    "interactive elements are keyboard-accessible and labeled",
    "no hardcoded colors/sizes where the project defines tokens",
  ];
  return `# Frontend work\n${bullets.map((b) => `- ${b}`).join("\n")}\n\nBefore calling a frontend task done, verify:\n${checklist.map((c) => `- ${c}`).join("\n")}`;
}

/**
 * Guidance for a directory with no project in it yet: scaffold properly
 * instead of writing loose files. Once a scaffold lands on disk, the next
 * turn's system prompt picks up the real stack card automatically.
 */
export function greenfieldGuidance(tier: PromptTier): string {
  if (tier === "lean") {
    return `# New project\n- If asked to build a web UI here, scaffold a real project first (default: Vite + React + TypeScript + Tailwind via \`bun create vite\`), then build inside it — no loose HTML/JS files.`;
  }
  return `# New project
- There is no project here yet. If asked to build a web UI, scaffold a real project first rather than writing loose HTML/JS files.
- Unless the user specifies a stack, default to Vite + React + TypeScript + Tailwind (\`bun create vite\`), install dependencies, and verify the dev server starts.
- Set up a components directory and design tokens (Tailwind theme / CSS variables) from the start, and keep all styling on those tokens.`;
}
