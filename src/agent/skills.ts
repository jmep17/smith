import { mkdir, readdir } from "node:fs/promises";
import type { PromptTier } from "../provider/profiles.ts";
import type { StackInfo } from "./stack.ts";

/**
 * Bundled cheat-sheets: version-keyed micro-references focused on APIs newer
 * than local models' training data — exactly where they hallucinate. Sheets
 * are materialized to disk so the model pulls them with the ordinary Read
 * tool; the system prompt carries only a one-line index (progressive
 * disclosure without a skills system).
 */
interface Cheatsheet {
  file: string;
  description: string;
  applies: (stack: StackInfo) => boolean;
  content: string;
}

const CHEATSHEETS: Cheatsheet[] = [
  {
    file: "tailwind-v4.md",
    description: "Tailwind v4 CSS-first config and renamed utilities",
    applies: (s) => s.styling?.startsWith("Tailwind v4") ?? false,
    content: `# Tailwind v4 cheat-sheet

Config is CSS-first — most v4 projects have NO tailwind.config.js:
- \`@import "tailwindcss";\` replaces the three @tailwind directives.
- Tokens live in CSS: \`@theme { --color-brand: #6c5ce7; --font-display: "Inter"; }\`
- Every \`--color-*\` token automatically becomes utilities: bg-brand, text-brand, border-brand.
- A JS config can still be loaded explicitly with \`@config "./tailwind.config.js";\` — only assume one exists if you see that line.
- Custom utilities use \`@utility name { … }\`, not \`@layer utilities\`.

Renamed/changed from v3 (do not use the old names):
- shadow-sm → shadow-xs; shadow → shadow-sm
- rounded-sm → rounded-xs; rounded → rounded-sm
- outline-none → outline-hidden
- ring is now 1px (was 3px) — use ring-3 for the old look
- Default border/divide color is currentColor, not gray-200; set a color explicitly.
- bg-opacity-* utilities are gone — use color/opacity syntax: bg-black/50.
`,
  },
  {
    file: "react-19.md",
    description: "React 19 APIs: ref-as-prop, use(), Actions, removed legacy APIs",
    applies: (s) => /React 19/.test(s.framework ?? ""),
    content: `# React 19 cheat-sheet

- \`ref\` is a normal prop on function components — do NOT use forwardRef for new code:
  \`function Input({ ref, ...props }: { ref?: React.Ref<HTMLInputElement> }) { return <input ref={ref} {...props} /> }\`
- \`use(promise)\` reads a promise during render (suspends); \`use(Context)\` reads context, legal inside conditionals.
- Context providers: render \`<MyContext value={x}>\` directly — no \`.Provider\` needed.
- Forms and Actions: \`<form action={asyncFn}>\`, \`useActionState(fn, initial)\`, \`useFormStatus()\` (child of the form), \`useOptimistic(state, update)\`.
- Document metadata: \`<title>\`, \`<meta>\`, \`<link>\` rendered inside components are hoisted to <head>.
- Removed — will crash or no-op: propTypes, defaultProps on function components (use default parameters), string refs, ReactDOM.render (use createRoot).
`,
  },
  {
    file: "nextjs-15.md",
    description: "Next.js 15 async request APIs and caching changes",
    applies: (s) => /Next\.js 15/.test(s.framework ?? ""),
    content: `# Next.js 15 cheat-sheet

Request APIs are now async — always await them:
- \`const c = await cookies()\`; \`const h = await headers()\`
- \`params\` and \`searchParams\` in pages/layouts are Promises:
  \`export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; … }\`

Caching defaults flipped from 14 — nothing is cached unless you ask:
- \`fetch\` is uncached by default; opt in with \`fetch(url, { cache: "force-cache" })\` or \`next: { revalidate: N }\`.
- GET route handlers are uncached by default.
- Client router cache no longer reuses page segments by default.

Structure reminders (app router):
- Components are server components unless the file starts with "use client".
- Server mutations: functions marked "use server" (server actions), called from forms/handlers.
- Layouts persist across navigations; loading.tsx / error.tsx are route-level conventions.
`,
  },
];

const sheetsDir = () => `${process.env.HOME}/.local/share/smith/sheets`;

interface Reference {
  path: string;
  description: string;
}

/** Write applicable bundled sheets to disk (idempotent) and list them. */
async function materializeCheatsheets(stack: StackInfo): Promise<Reference[]> {
  const applicable = CHEATSHEETS.filter((s) => s.applies(stack));
  if (applicable.length === 0) return [];
  const dir = sheetsDir();
  await mkdir(dir, { recursive: true });
  const refs: Reference[] = [];
  for (const sheet of applicable) {
    const path = `${dir}/${sheet.file}`;
    const file = Bun.file(path);
    if (!(await file.exists()) || (await file.text()) !== sheet.content) {
      await Bun.write(path, sheet.content);
    }
    refs.push({ path, description: sheet.description });
  }
  return refs;
}

/** Repo-local playbooks the user maintains in .smith/skills/*.md. */
async function repoPlaybooks(cwd: string): Promise<Reference[]> {
  try {
    const files = await readdir(`${cwd}/.smith/skills`);
    return files
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => ({ path: `.smith/skills/${f}`, description: "project playbook" }));
  } catch {
    return [];
  }
}

/**
 * One-line-per-entry index of on-demand reference material. The model loads
 * entries with Read when relevant; lean profiles get at most two entries
 * because small models handle optional context poorly.
 */
export async function referenceIndex(
  cwd: string,
  stack: StackInfo | null,
  tier: PromptTier,
): Promise<string | null> {
  const refs = [
    ...(stack ? await materializeCheatsheets(stack) : []),
    ...(await repoPlaybooks(cwd)),
  ];
  if (refs.length === 0) return null;
  const shown = tier === "lean" ? refs.slice(0, 2) : refs;
  const lines = shown.map((r) => `- ${r.path} — ${r.description}`);
  return `# Reference material\nRead the relevant file below before using APIs you are unsure about; these cover recent changes.\n${lines.join("\n")}`;
}
