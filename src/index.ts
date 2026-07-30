#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { AgentSession } from "./agent/loop.ts";
import { AgentBus } from "./events.ts";
import { attachHeadlessRenderer } from "./headless.ts";
import { loadSettings } from "./permissions/store.ts";
import { checkHealth } from "./provider/health.ts";
import { getProfile } from "./provider/profiles.ts";

const HELP = `smith — a local-model coding agent

Usage:
  smith                     interactive TUI session
  smith -p "prompt"         one-shot headless run
  smith --help

Options:
  -p, --prompt <text>   Run one prompt and exit
  --init                Generate an AGENT.md for the current project and exit
  --profile <name>      Hardware profile: m4 | air (default: auto by RAM)
  --model <id>          Override the profile's model (must match an LM Studio model id;
                        also settable via SMITH_MODEL)
  --allow <rule>        Permission allow rule, repeatable, e.g. --allow "Bash(npm *)"
  -y, --yes             Auto-approve all permission requests (headless)
  -q, --quiet           Only print the final answer (with -p)
  -c, --continue        Resume the most recent session
  --resume <file>       Resume a specific session JSONL file
`;

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      prompt: { type: "string", short: "p" },
      init: { type: "boolean", default: false },
      profile: { type: "string" },
      model: { type: "string" },
      allow: { type: "string", multiple: true },
      yes: { type: "boolean", short: "y", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      continue: { type: "boolean", short: "c", default: false },
      resume: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  if (values.init) {
    // Template-driven: deterministic stack detection fills the file, no model needed.
    const { runInit } = await import("./agent/init.ts");
    console.log(`wrote ${await runInit(process.cwd())}`);
    return;
  }

  const profile = getProfile(values.profile, values.model);
  const health = await checkHealth(profile);
  if (!health.ok) {
    console.error(`smith: ${health.message}`);
    process.exit(1);
  }

  const cwd = process.cwd();
  const settings = await loadSettings(cwd, values.allow ?? []);
  const dataDir = `${process.env.HOME}/.local/share/smith`;
  const spillDir = `${dataDir}/spill`;
  const sessionDir = `${dataDir}/sessions`;
  await mkdir(spillDir, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  const sessionFile = `${sessionDir}/${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.jsonl`;

  const bus = new AgentBus();
  const session = new AgentSession({
    cwd,
    profile,
    settings,
    bus,
    spillDir,
    sessionFile,
  });

  let resumedFrom: string | null = null;
  if (values.resume || values.continue) {
    const { latestSessionFile, loadSessionMessages } = await import("./session/store.ts");
    const target = values.resume ?? (await latestSessionFile());
    if (!target) {
      console.error("smith: no previous session to resume");
      process.exit(1);
    }
    session.restore(await loadSessionMessages(target));
    resumedFrom = target;
  }

  if (values.prompt) {
    attachHeadlessRenderer(bus, {
      autoApprove: values.yes,
      verbose: !values.quiet,
    });
    await session.run(values.prompt);
    return;
  }

  const [{ render }, React, { App }, { TuiStore }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./tui/App.tsx"),
    import("./tui/store.ts"),
  ]);
  const store = new TuiStore(bus);
  if (resumedFrom) {
    store.addInfo(
      `resumed ${session.messages.length} messages from ${resumedFrom.split("/").at(-1)}`,
    );
  }
  const instance = render(React.createElement(App, { session, store, profile }), {
    exitOnCtrlC: true,
  });
  await instance.waitUntilExit();
}

main().catch((err) => {
  console.error(`smith: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
