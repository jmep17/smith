import type { PromptTier } from "../provider/profiles.ts";
import type { StackInfo } from "./stack.ts";

const MOCKUP_KEYWORDS = /\b(mock[- ]?ups?|wireframes?|prototyp(e|es|ing))\b/i;

/** True when the user's message asks for mockup/wireframe/prototype work. */
export function wantsMockup(text: string): boolean {
  return MOCKUP_KEYWORDS.test(text);
}

/**
 * Priors for mockup/wireframe work. Mockups are standalone throwaway HTML,
 * a different mode from production code, so this only enters the prompt on
 * turns where the session has asked for one (see AgentSession.mockupMode).
 */
export function mockupGuidance(stack: StackInfo | null, tier: PromptTier): string {
  const hasDesignSystem = stack?.styling != null;

  if (tier === "lean") {
    const bullets = [
      "Deliver each screen as one self-contained HTML file in `mockups/` — all CSS/JS inline, no external requests, no build step.",
      "Make it clickable with small inline JS: nav switches screens, tabs, modals, form states.",
      hasDesignSystem
        ? "Wireframes: grayscale, system fonts, labeled placeholder boxes. Hi-fi: reuse the project's real colors/fonts (Read the token source)."
        : "Wireframes: grayscale, system fonts, labeled placeholder boxes. Hi-fi: pick one accent color and stay consistent.",
      "Use realistic content (plausible names, numbers, dates), never lorem ipsum in hi-fi.",
      "Mockups are throwaway: component conventions and typecheck rules do not apply. Tell the user to run `open mockups/<file>.html`, then iterate with Edit.",
    ];
    return `# Mockups & wireframes\n${bullets.map((b) => `- ${b}`).join("\n")}`;
  }

  const bullets = [
    "Deliver each screen as one self-contained HTML file in `mockups/`: all CSS and JS inline, viewport meta, no external requests (no CDN, no fonts, no images from the network), no build step. The file must open instantly in a browser.",
    "Interactive means clickable: navigation that switches screens (hash-based sections or toggling `hidden` with a few lines of inline JS), working tabs, expandable panels, modals that open and close, form fields with validation states, visible hover/focus styles. No frameworks.",
    "Pick the fidelity from the request (ask if unclear). Wireframe (lo-fi): grayscale palette, system font stack, labeled placeholder boxes, X-crossed rectangles for images — but real layout, spacing, and hierarchy. Hi-fi: realistic content — plausible names, numbers, dates, message text; lorem ipsum is a fidelity bug.",
    ...(hasDesignSystem
      ? [
          "This repo has a design system: for hi-fi mockups, Read the token source (tailwind config, globals.css, or theme file) first and reuse its colors, fonts, spacing, and radii so the mockup looks like the product.",
        ]
      : []),
    "For a multi-screen flow, prefer a single file with hash-routed screens so the flow is walkable; use separate files linked to each other only for unrelated screens.",
    "Mockups are throwaway artifacts, exempt from the production rules above: no component conventions, no exemplar matching, no typecheck. Never import mockup code into production or production components into mockups.",
    "After writing a file, tell the user to run `open mockups/<file>.html`. Iterate with Edit in small diffs — do not regenerate the whole file for a small change.",
  ];
  return `# Mockups & wireframes\n${bullets.map((b) => `- ${b}`).join("\n")}`;
}
