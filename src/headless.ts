// -p mode and the pre-TUI REPL: render agent events as plain terminal text.

import type { AgentBus } from "./events.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

export interface HeadlessOptions {
  /** Auto-approve every permission request (--yes). Otherwise: deny. */
  autoApprove: boolean;
  /** Print tool activity (default true; false = only final text). */
  verbose: boolean;
}

export function attachHeadlessRenderer(bus: AgentBus, opts: HeadlessOptions): void {
  let streaming = false;
  bus.on((event) => {
    switch (event.type) {
      case "text-delta":
        streaming = true;
        process.stdout.write(event.text);
        break;
      case "text-end":
        streaming = false;
        process.stdout.write("\n");
        break;
      case "tool-call":
        if (opts.verbose) {
          const spec =
            event.specifier.length > 120
              ? `${event.specifier.slice(0, 120)}…`
              : event.specifier;
          process.stdout.write(`${bold(`⏺ ${event.name}`)}${dim(`(${spec})`)}\n`);
        }
        break;
      case "tool-result":
        if (opts.verbose) {
          const first = event.output.split("\n")[0] ?? "";
          const preview = first.length > 150 ? `${first.slice(0, 150)}…` : first;
          const lines = event.output.split("\n").length;
          const suffix = lines > 1 ? dim(` (+${lines - 1} lines)`) : "";
          process.stdout.write(
            `  ${event.isError ? red(`⎿ ${preview}`) : dim(`⎿ ${preview}`)}${suffix}\n`,
          );
        }
        break;
      case "repair":
        if (opts.verbose)
          process.stdout.write(`  ${red(`↻ repair: ${event.message}`)}\n`);
        break;
      case "info":
        if (opts.verbose) process.stdout.write(`  ${dim(`· ${event.message}`)}\n`);
        break;
      case "permission-request": {
        if (opts.autoApprove) {
          if (opts.verbose)
            process.stdout.write(`  ${green("✓ auto-approved (--yes)")}\n`);
          event.respond("once");
        } else {
          process.stdout.write(
            `  ${red(`✗ denied: ${event.name}(${event.specifier})`)} ${dim("(headless default — pass --yes or --allow)")}\n`,
          );
          event.respond("deny");
        }
        break;
      }
      case "error":
        if (streaming) process.stdout.write("\n");
        process.stdout.write(`${red(`error: ${event.message}`)}\n`);
        break;
    }
  });
}
