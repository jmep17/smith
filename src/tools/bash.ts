import { z } from "zod";
import type { ToolDef } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const OUTPUT_CAP = 30_000;
const PWD_MARKER = "__SMITH_PWD__";

const schema = z.object({
  command: z.string().describe("The shell command to run"),
  timeout: z
    .number()
    .optional()
    .describe(`Timeout in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS})`),
});

export const bashTool: ToolDef<typeof schema> = {
  name: "Bash",
  description:
    "Run a shell command (zsh). cd persists to the next command; environment variables do not. Output over 30k chars is truncated and spilled to a file.",
  schema,
  readOnly: false,
  specifier: (input) => input.command,
  async execute(input, ctx) {
    const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    // The EXIT trap prints a pwd marker even when the command calls `exit`,
    // letting `cd` persist across calls without touching the exit status.
    const wrapped = `trap 'printf "\\n${PWD_MARKER}%s" "$PWD"' EXIT\n${input.command}`;
    const proc = Bun.spawn(["/bin/zsh", "-c", wrapped], {
      cwd: ctx.cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    let out = stdout;
    const markerIdx = out.lastIndexOf(PWD_MARKER);
    if (markerIdx !== -1) {
      const newCwd = out.slice(markerIdx + PWD_MARKER.length).trim();
      out = out.slice(0, markerIdx).replace(/\n$/, "");
      if (newCwd && newCwd !== ctx.cwd) ctx.setCwd(newCwd);
    }

    let result = out;
    if (stderr.trim()) result += `${result ? "\n" : ""}[stderr] ${stderr.trim()}`;
    if (proc.signalCode) {
      result += `${result ? "\n" : ""}[command timed out after ${timeout}ms (${proc.signalCode})]`;
    } else if (exitCode !== 0) {
      result += `${result ? "\n" : ""}[exit code ${exitCode}]`;
    }

    if (result.length > OUTPUT_CAP) {
      const spillPath = `${ctx.spillDir}/bash-${Date.now()}.txt`;
      await Bun.write(spillPath, result);
      result =
        result.slice(0, OUTPUT_CAP) +
        `\n[output truncated at ${OUTPUT_CAP} chars — full output: ${spillPath}]`;
    }
    return result || "(no output)";
  },
};
