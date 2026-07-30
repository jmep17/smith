# Making smith think like a professional frontend developer

A brainstorm of mechanisms for giving the agent the working knowledge a professional
frontend developer carries: the project's stack, its conventions, its design system,
and a way to verify UI work. Ideas are grounded in smith's current architecture and
end with a recommended incremental roadmap.

## Where we start from

Today smith is completely stack-agnostic. The entire prompt surface is
`src/agent/system-prompt.ts`: a generic ~15-line base prompt, environment info
(cwd, platform, date, git status), and the verbatim contents of `AGENT.md` if one
exists. Nothing in the nine-tool set knows what a component, a design token, or a
dev server is. There is no stack detection, no retrieval, no skills mechanism, no
docs cache, and no browser tooling.

Two facts about the runtime shape every idea below:

1. **The models are small and local.** The `air` profile runs a 9B model in a
   16,384-token window with a 4,000-char tool-result cap. A 9B model cannot recover
   from a bloated prompt — every always-on token is stolen from its ability to hold
   the actual code. The `m4` profile (30B @ 128K) has room to breathe, but the same
   discipline keeps it sharp.
2. **The models are text-only.** No screenshots, no vision. Anything visual or
   runtime-shaped has to be converted into text the model can reason about.

So the winning ideas (a) inject *small, high-leverage* context, (b) make runtime
reality *legible as text*, and (c) load heavy context *on demand* rather than
always-on. Conveniently, `buildSystemPrompt(cwd, _profile, memory)` already accepts
a profile parameter it never uses — a ready-made seam for tiering everything below.

## The ideas

### 1. Stack detection → a "project stack card" in the system prompt

At session start (cached on `package.json` mtime), deterministically detect the
frontend stack: parse `package.json` (deps + scripts), check for
`tailwind.config.*`, `vite.config.*`, `next.config.*`, `tsconfig.json`,
`svelte.config.*`, eslint/postcss configs, and component directories. Emit a
~10-line card:

```
# Project stack
- framework: Next.js 15 (app router), React 19, TypeScript strict
- styling: Tailwind v4 + shadcn/ui; tokens in src/styles/globals.css
- state: zustand; forms: react-hook-form + zod
- scripts: dev=`next dev`, check=`tsc --noEmit`, lint=`eslint .`
- components live in: src/components/ (PascalCase .tsx, co-located .test.tsx)
```

**Why it's first.** This is a professional's opening move in an unfamiliar repo. It
stops the model from guessing — writing CSS modules in a Tailwind repo, `pages/`
idioms in an app-router repo, npm commands in a bun project — and it feeds nearly
every other idea here (guidance selection, doc lookup, diagnostics commands).
Detection is pure file reading, no LLM call: deterministic beats asking a 9B model
to summarize.

**Cost:** low. New `src/agent/stack.ts`, called from `buildSystemPrompt()`.
**Tokens:** ~100–180, affordable on both profiles.

### 2. A conditional frontend guidance module, tiered by profile

When stack detection says "this is a frontend repo," append a curated guidance
block — the distilled instincts of a senior frontend dev, conditioned on the
detected stack so React repos don't pay for Vue advice:

- component conventions: naming, file placement, typed props
- accessibility non-negotiables: semantic elements, labels, focus order, keyboard
- responsive-first habits
- state-management idioms for the detected library
- "before creating a component, read a similar existing one" (see idea 4)
- "run the typecheck after edits" (see idea 7)

Tier it through the currently unused `_profile` parameter, the same pattern as the
existing `disabledTools`: `m4` gets the full ~500-token module, `air` gets a
~120-token compressed version — five to eight imperative bullets, no prose.

**Why it matters.** These priors are exactly what local models lack relative to
frontier models, and static text is zero-latency and always applies. The real work
is content authoring, not code.

**Cost:** low. New `src/agent/frontend-guidance.ts`; two-line change in
`buildSystemPrompt`. **Tokens:** 400–600 on m4, 100–150 on air.

### 3. `/init`-style AGENT.md generation + design-token extraction

Two related pieces that make context durable and user-editable:

- **`/init` command.** A template-driven survey that writes `AGENT.md`: stack
  summary, directory conventions, "how to add a component here," commands.
  Deterministic detection (idea 1) fills most fields; the LLM only writes the
  conventions prose — important because generation quality is bounded by the local
  model doing the surveying. The existing `loadMemory()` path then injects it every
  turn with zero new plumbing.
- **Design-token extraction.** Parse `tailwind.config.*` theme extensions and/or
  `:root` CSS variables into a short palette/spacing/typography card
  (`colors: brand=#6C5CE7 via bg-brand; radius: rounded-xl standard; font: Inter`).

Tokens are how a codebase *looks*. A model that knows the token vocabulary writes
`text-brand` instead of `text-[#6C5CE7]` — the difference between code that looks
native and code that looks pasted from a tutorial.

**Cost:** medium (needs a command entry point; Tailwind-config parsing is a
manageable regex job). **Tokens:** token card ~80–150; cap generated AGENT.md per
profile (~600 tokens on air) since `loadMemory` currently injects unconditionally.

### 4. Exemplar retrieval: read a sibling before writing a new component

Real developers pattern-match off neighboring code constantly. Three escalating
implementations:

- **(a) Prompt-only** — one bullet in the guidance module: "Glob the components
  directory and Read one similar existing component; match its structure exactly."
  Zero code; the tools already exist. Ship this first.
- **(b) A `FindExemplar` tool** — ranks candidates by filename similarity + shared
  imports (grep-based), returns the best match's contents. Build only if (a)
  proves insufficient — it removes a round-trip and the risk of a 9B picking a bad
  exemplar.
- **(c) Embeddings/RAG** — skip indefinitely. Index maintenance and an embedding
  model competing for the same RAM as the chat model, for marginal gain over grep
  in single-repo scope.

**Cost:** (a) free, (b) low-medium. **Tokens:** one component file per use
(~300–1,500), on demand only; `maxToolResultChars` already bounds it on air.

### 5. An on-demand playbooks directory

A `.smith/skills/` directory of markdown playbooks — `add-component.md`,
`responsive-layout.md`, `form-with-validation.md`, `a11y-audit.md`. The system
prompt carries only a one-line index ("Available playbooks: …; Read one when
relevant"); the model pulls full text with the existing Read tool. Progressive
disclosure without building a skills *system* — no frontmatter, no triggers, no
machinery.

**Risk flag:** small models are bad at *deciding* to fetch optional context. On
`air`, list at most two or three playbooks and phrase triggers concretely ("when
creating a form, first Read …").

**Cost:** low. **Tokens:** index ~30–60 always-on; playbook 300–800 on demand.

### 6. Docs: bundled cheat-sheets first, live fetching second

- **(a) Bundled version-keyed cheat-sheets** (`tailwind-v4.md`, `react-19.md`,
  `nextjs-15-app-router.md`), selected by stack detection and exposed through the
  playbook index. Focus on *post-training-cutoff deltas* — Tailwind v4's CSS-first
  config, React 19 API changes — because that is precisely where local models
  hallucinate. They go stale; accept it, keep them small and versioned.
- **(b) WebFetch-based live docs** with a disk cache keyed by URL + week, so the
  local-first property mostly survives. smith already routes web extraction through
  `smallModel`, so summarize-on-fetch is nearly free to wire. Treat as an `m4`
  enhancement — a 9B model rarely decides to fetch docs well, and summaries eat
  the tiny context.

**Cost:** (a) low code, medium curation; (b) medium.

### 7. A text-based runtime feedback loop (the screenshot substitute)

Since the models can't see, make the runtime legible as text. In ascending cost:

- **(a) Post-edit diagnostics — the core.** After Edit/Write touches a
  `.ts(x)/.vue/.svelte` file, run fast checks (the project's `check` script, else
  scoped `tsc --noEmit`, plus eslint on the changed file) and append errors-first,
  truncated output to the tool result. This converts smith's existing three-strike
  self-repair loop from a *call-shape* repair loop into a *code-correctness* one.
  Local models produce plausible-but-broken code; immediate compiler feedback is
  the cheapest ground truth there is. Debounce per file, cap at ~10 errors, and
  profile-gate it. When clean it costs ~5 tokens ("✓ typecheck passed").
- **(b) Dev-server awareness.** Port-probe 3000/5173/8080 (or infer from scripts),
  report its existence in the stack card. Detect and report only — smith has no
  background-process management yet.
- **(c) Console/network error capture.** A small injected client snippet or vite
  plugin mirroring browser errors to a file the agent can Read. Valuable but
  framework-specific; build after (a) proves the feedback-loop pattern.
- **(d) DOM/accessibility-tree snapshots.** Headless Playwright renders a route and
  emits the a11y tree — the true screenshot replacement for layout and a11y
  verification. Heavy dependency, competes with the model for RAM, 1–3K tokens per
  snapshot. Defer; `m4`-only if ever; never for `air`.

**Status: (a) and (b) implemented** (`src/agent/diagnostics.ts`, hooked in
`AgentSession.dispatch`). Implementation notes vs the sketch above: typecheck
only in v1 — eslint deferred for latency; a `typecheck`/`check` script is used
only when its command starts with `tsc`, otherwise the local
`node_modules/.bin/tsc` binary runs directly — Edit/Write permission must not
become silent execution of arbitrary npm scripts. 10s debounce
(`ToolContext.lastDiagnosticsAt`), 45s timeout, errors truncated at 1,600 chars,
gated by `Profile.postEditChecks`. The design-token lint (idea 10) rides the
same hook. Dev-server detection is a 250ms port probe (3000/5173/8080/4321),
run only for frontend repos, surfaced as an Environment line.

**Hook:** a post-tool step in `src/agent/loop.ts` is cleaner than teaching each
tool about diagnostics; command selection comes from stack detection.

### 8. Explicit per-profile token budgets

Make the context budget a policy rather than an accident. Proposed system-prompt
ceilings (including the existing ~250-token base):

| Component                    | m4     | air    |
| ---------------------------- | ------ | ------ |
| Stack card (1)               | 180    | 120    |
| Frontend guidance (2)        | 600    | 150    |
| Design-token card (3)        | 150    | 80     |
| Playbook/cheat-sheet index   | 60     | 0–30   |
| AGENT.md (capped)            | 1,500  | 600    |
| **Total ceiling**            | ~3,000 | ~1,200 |

Mechanically: a budget or `tier` field on `Profile`, enforced at the
`system-prompt.ts` chokepoint — the same philosophy as `maxToolResultChars` and
`disabledTools`. A dev-mode log line printing estimated tokens per section keeps it
honest. This is the discipline that makes every other idea safe to ship: the
classic failure mode is context "features" accreting until the small model is worse
than before.

### 9. Component inventory map

A cached one-line-per-component index
(`Button  src/components/ui/button.tsx  — variants: default|ghost|outline`),
generated by cheap regex parsing of export and prop-type names. Stops the model
from re-implementing components that already exist — a top local-model failure.
On-demand or AGENT.md-referenced; `m4`/large-repo tier. Needs staleness handling
(regenerate on init or when file count changes).

### 10. Token-discipline lint

Riding idea 7a's hook: after edits in a repo that has design tokens, a regex check
for hardcoded hex colors and arbitrary Tailwind values (`bg-[#…]`, `px-[13px]`),
appended as a warning ("this repo uses design tokens; found `#6C5CE7`, consider
`bg-brand`"). Design-system conformance for near-zero tokens and near-zero code.

### 11. A "definition of done" checklist

A four-line self-verification epilogue in the guidance module: typecheck passes;
an existing component was reused or an exemplar matched; interactive elements are
keyboard- and label-accessible; no hardcoded values where tokens exist. Small
models respond well to explicit terminal checklists, and it's effectively free.

### 12. Small-model preprocessing

Use the existing `smallModel` plumbing (compaction and web extraction already do
this) to summarize large fetched docs or oversized exemplar files before they enter
the main context. An opportunistic optimization, not a foundation — and on `air`,
where `smallModel` equals the main model, it costs latency.

### 13. Mockup & wireframe mode (implemented)

Mockups are a distinct working mode from production code — standalone, disposable,
visual-first, and exempt from house conventions — so they get their own guidance
module (`src/agent/mockup-guidance.ts`) rather than a place in the always-on
frontend block. The deliverable prior: one self-contained HTML file per screen in
`mockups/`, all CSS/JS inline, no build step and no network requests, interactive
via small inline vanilla JS (hash-routed screens, tabs, modals, form states) —
the only mockup format a terminal agent and a text-only local model can reliably
produce, view (`open mockups/x.html`), and iterate on. Fidelity is explicit:
grayscale labeled-placeholder wireframes vs hi-fi mockups with realistic content,
which reuse the repo's design tokens when a design system is detected.

Because small models fetch optional context poorly (the idea-5 risk), the mode is
triggered deterministically: `wantsMockup()` keyword-matches the user's prompt
(mockup/wireframe/prototype) in `AgentSession.runTurn`, sticks for the rest of the
session so iteration turns keep the guidance, and is re-derived from restored
messages on `--resume`. When active it also supersedes greenfield scaffolding
guidance — loose HTML is the point, not a mistake. Cost: zero on non-mockup
sessions; one tiered section (~500 tokens full / ~150 lean) when active.

## Explicitly overkill for local models

- **Embeddings/RAG** — infra weight and RAM contention for marginal gain over
  grep/glob in single-repo scope.
- **Screenshots of any kind** — the models are text-only; dead on arrival.
- **A full skills system** (frontmatter, triggers, marketplaces) — a directory of
  markdown plus a one-line index gets 80% of the value at 5% of the machinery.
- **Headless browser snapshots (7d)** — defer; revisit `m4`-only.
- **Live doc fetching as the primary strategy on `air`** — prefer bundled
  cheat-sheets and strong static guidance.

## Recommended roadmap

**Phase 1 — Stack awareness.** Ideas 1 + 2 (folding in 4a and 11) + 8. Highest
value per token, purely additive, zero new tools, zero runtime risk, and it
activates the `_profile` seam already waiting in `buildSystemPrompt`. Everything
later depends on stack detection existing. Deliverables: new `src/agent/stack.ts`
and `src/agent/frontend-guidance.ts`; edits to `src/agent/system-prompt.ts` and
`src/provider/profiles.ts`.

**Phase 2 — Ground-truth feedback.** 7a post-edit diagnostics (post-tool hook in
`src/agent/loop.ts`, profile-gated, debounced, errors-first truncation), with 10
riding the same hook and 7b's dev-server line in the stack card. The biggest
quality delta after Phase 1 — it's what makes a small model's output trustworthy.

**Phase 3 — Persistent project memory.** 3 (`/init` AGENT.md generation +
design-token card) and 9 (component inventory, m4/large-repo tier). Needs Phase 1's
detection; makes context durable and user-editable.

**Phase 4 — On-demand depth.** 5 (playbooks) and 6a (bundled cheat-sheets) behind
the same index; 6b (WebFetch doc cache) as an m4 enhancement; 4b (`FindExemplar`)
only if the prompt-only version proves insufficient in practice.

**Deferred or never:** 7d headless snapshots (revisit m4-only), 7c console capture
(after Phase 2 proves out), 4c embeddings (never), 12 preprocessing
(opportunistic).

## Touch points in the current architecture

| File | Role in this plan |
| --- | --- |
| `src/agent/system-prompt.ts` | The single chokepoint: stack card, guidance module, AGENT.md, budget enforcement; the unused `_profile` seam |
| `src/provider/profiles.ts` | Profile tiering: budget/tier fields, diagnostics gating, `disabledTools` |
| `src/agent/loop.ts` | Post-tool hook for after-edit diagnostics and token lint; interplay with self-repair and compaction |
| `src/tools/types.ts` | `ToolContext` extensions: cached stack info, diagnostics debounce state |
| `src/tools/index.ts` | Registration point for any new tool, honoring `disabledTools` |
