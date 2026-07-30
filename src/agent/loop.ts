import {
  type LanguageModel,
  type ModelMessage,
  streamText,
  type ToolResultPart,
  type ToolSet,
  tool,
} from "ai";
import {
  describeError,
  engineErrorHint,
  isTransientEngineError,
  toError,
} from "../errors.ts";
import type { AgentBus } from "../events.ts";
import { evaluatePermission, ruleForAlways } from "../permissions/engine.ts";
import { type PermissionSettings, persistAllowRule } from "../permissions/store.ts";
import { mainModel } from "../provider/client.ts";
import type { Profile } from "../provider/profiles.ts";
import { toolsForProfile } from "../tools/index.ts";
import { resolvePath, type ToolContext, type ToolDef } from "../tools/types.ts";
import { compactMessages, estimateTokens } from "./compact.ts";
import { runPostEditChecks } from "./diagnostics.ts";
import { wantsMockup } from "./mockup-guidance.ts";
import { buildSystemPrompt, loadMemory } from "./system-prompt.ts";

const MAX_CONSECUTIVE_REPAIRS = 3;
/** Extra attempts for a step whose stream died before producing anything. */
const MAX_STREAM_RETRIES = 2;
const STREAM_RETRY_BASE_MS = 500;

export interface AgentSessionOptions {
  cwd: string;
  profile: Profile;
  settings: PermissionSettings;
  bus: AgentBus;
  spillDir: string;
  abortSignal?: AbortSignal;
  /** JSONL file that receives every message appended during a turn. */
  sessionFile?: string;
  /** Override the profile's model — tests inject a mock here. */
  model?: LanguageModel;
}

export class AgentSession {
  readonly bus: AgentBus;
  readonly messages: ModelMessage[] = [];
  private readonly opts: AgentSessionOptions;
  private readonly tools: Map<string, ToolDef>;
  private readonly toolSet: ToolSet;
  private readonly ctx: ToolContext;
  /** Sticky once a turn asks for mockup/wireframe work, so iteration keeps the guidance. */
  private mockupMode = false;

  constructor(opts: AgentSessionOptions) {
    this.opts = opts;
    this.bus = opts.bus;
    this.tools = toolsForProfile(opts.profile);
    this.toolSet = Object.fromEntries(
      [...this.tools.values()].map((t) => [
        t.name,
        // No execute function: the SDK returns tool calls instead of running
        // them, so the harness owns dispatch (permission gate + repair loop).
        tool({ description: t.description, inputSchema: t.schema }),
      ]),
    );
    this.ctx = {
      cwd: opts.cwd,
      readFiles: new Set(),
      profile: opts.profile,
      spillDir: opts.spillDir,
      setCwd: (dir) => {
        this.ctx.cwd = dir;
      },
      todos: [],
      lastDiagnosticsAt: 0,
    };
  }

  /** Swap the abort signal before a turn (used by the TUI's esc handler). */
  setAbortSignal(signal: AbortSignal): void {
    this.opts.abortSignal = signal;
  }

  /** Restore messages from a previous session (--resume/--continue). */
  restore(messages: ModelMessage[]): void {
    this.messages.push(...messages);
    for (const m of messages) {
      if (m.role === "user" && typeof m.content === "string" && wantsMockup(m.content)) {
        this.mockupMode = true;
      }
    }
  }

  /** Estimated context usage as a fraction of the profile's limit. */
  usage(): { tokens: number; limit: number; fraction: number } {
    const tokens = estimateTokens(this.messages);
    const limit = this.opts.profile.contextLength;
    return { tokens, limit, fraction: tokens / limit };
  }

  /** Replace the conversation with a model-written summary. */
  async compact(): Promise<void> {
    if (this.messages.length === 0) return;
    const summary = await compactMessages(this.messages, this.opts.profile);
    this.messages.length = 0;
    this.messages.push(...summary);
  }

  /** Run one user turn to completion. Returns the final assistant text. */
  async run(prompt: string): Promise<string> {
    const logFrom = this.messages.length;
    try {
      return await this.runTurn(prompt);
    } finally {
      await this.appendLog(logFrom);
    }
  }

  private async appendLog(from: number): Promise<void> {
    const { sessionFile } = this.opts;
    if (!sessionFile || this.messages.length <= from) return;
    const lines = this.messages
      .slice(from)
      .map((m) => JSON.stringify(m))
      .join("\n");
    const file = Bun.file(sessionFile);
    const existing = (await file.exists()) ? await file.text() : "";
    await Bun.write(sessionFile, `${existing + lines}\n`);
  }

  private async runTurn(prompt: string): Promise<string> {
    const { profile, bus } = this.opts;
    if (wantsMockup(prompt)) this.mockupMode = true;
    const memory = await loadMemory(this.ctx.cwd);
    const system = await buildSystemPrompt(this.ctx.cwd, profile, memory, {
      mockups: this.mockupMode,
    });
    this.messages.push({ role: "user", content: prompt });

    let step = 0;
    let consecutiveRepairs = 0;
    let finalText = "";

    while (step < profile.maxSteps) {
      step++;
      bus.emit({ type: "step-start", step });
      this.trimHistory();
      // Auto-compact: if elision alone can't get us under ~80% of the
      // window, replace history with a summary before the next call.
      if (this.usage().fraction > 0.8) {
        bus.emit({ type: "info", message: "context nearly full — auto-compacting" });
        await this.compact();
        this.messages.push({
          role: "user",
          content: `[continue the current task: ${prompt}]`,
        });
      }

      const { stepText, toolCalls, responseMessages } = await this.streamStep(system);
      this.messages.push(...responseMessages);

      if (toolCalls.length === 0) {
        finalText = stepText;
        break;
      }

      const results: ToolResultPart[] = [];
      let repairedThisStep = false;
      for (const call of toolCalls) {
        const output = await this.dispatch(call, () => {
          repairedThisStep = true;
        });
        results.push(output);
      }
      // response.messages may already include a tool message for
      // provider-executed tools; ours never are, so always append.
      this.messages.push({ role: "tool", content: results });

      if (repairedThisStep) {
        consecutiveRepairs++;
        if (consecutiveRepairs >= MAX_CONSECUTIVE_REPAIRS) {
          throw new Error(
            `model produced ${MAX_CONSECUTIVE_REPAIRS} malformed tool calls in a row — giving up on this turn.`,
          );
        }
      } else {
        consecutiveRepairs = 0;
      }
    }

    if (step >= profile.maxSteps && !finalText) {
      finalText = `[stopped: reached the ${profile.maxSteps}-step limit for one turn]`;
    }
    bus.emit({ type: "turn-end", text: finalText, steps: step });
    return finalText;
  }

  /**
   * One model call, streamed. Engine hiccups (LM Studio 500 "Compute error")
   * are retried with backoff as long as the failed attempt produced nothing —
   * retrying after partial output would duplicate it in the transcript.
   */
  private async streamStep(system: string): Promise<{
    stepText: string;
    toolCalls: Awaited<ReturnType<typeof streamText>["toolCalls"]>;
    responseMessages: ModelMessage[];
  }> {
    const { profile, bus } = this.opts;

    for (let attempt = 0; ; attempt++) {
      let stepText = "";
      try {
        const result = streamText({
          model: this.opts.model ?? mainModel(profile),
          system,
          messages: this.messages,
          tools: this.toolSet,
          temperature: profile.temperature,
          topP: profile.topP,
          abortSignal: this.opts.abortSignal,
          // The SDK's default handler console.errors the raw payload, which
          // scribbles over the Ink frame. We surface errors ourselves.
          onError: () => {},
        });

        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            stepText += part.text;
            bus.emit({ type: "text-delta", text: part.text });
          } else if (part.type === "reasoning-delta") {
            bus.emit({ type: "reasoning-delta", text: part.text });
          } else if (part.type === "error") {
            throw toError(part.error);
          }
        }
        if (stepText) bus.emit({ type: "text-end" });

        return {
          stepText,
          toolCalls: await result.toolCalls,
          responseMessages: (await result.response).messages,
        };
      } catch (err) {
        const aborted = this.opts.abortSignal?.aborted ?? false;
        const retriable =
          !aborted &&
          !stepText &&
          attempt < MAX_STREAM_RETRIES &&
          isTransientEngineError(err);
        if (!retriable) {
          if (aborted) throw toError(err);
          const hint = engineErrorHint(err);
          throw new Error(
            `model call failed: ${describeError(err)}${hint ? `\nhint: ${hint}` : ""}`,
            { cause: err },
          );
        }
        bus.emit({
          type: "info",
          message: `engine error (${describeError(err)}) — retrying ${attempt + 1}/${MAX_STREAM_RETRIES}`,
        });
        await Bun.sleep(STREAM_RETRY_BASE_MS * 2 ** attempt);
      }
    }
  }

  private async dispatch(
    call: {
      toolCallId: string;
      toolName: string;
      input: unknown;
      invalid?: boolean;
      error?: unknown;
    },
    markRepair: () => void,
  ): Promise<ToolResultPart> {
    const { bus } = this.opts;
    const asResult = (value: string): ToolResultPart => ({
      type: "tool-result",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: { type: "text", value },
    });

    const toolDef = this.tools.get(call.toolName);
    if (call.invalid || !toolDef) {
      markRepair();
      const reason = !toolDef
        ? `unknown tool '${call.toolName}'. Available tools: ${[...this.tools.keys()].join(", ")}`
        : `invalid tool input: ${call.error == null ? "unparsable arguments" : describeError(call.error)}`;
      bus.emit({ type: "repair", message: reason });
      return asResult(`ERROR: ${reason}. Fix the call and try again.`);
    }

    const parsed = toolDef.schema.safeParse(call.input);
    if (!parsed.success) {
      markRepair();
      const reason = `invalid arguments for ${call.toolName}: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`;
      bus.emit({ type: "repair", message: reason });
      return asResult(`ERROR: ${reason}. Fix the call and try again.`);
    }

    const specifier = toolDef.specifier(parsed.data);
    bus.emit({
      type: "tool-call",
      id: call.toolCallId,
      name: call.toolName,
      input: parsed.data,
      specifier,
    });

    const decision = await this.checkPermission(toolDef, specifier, parsed.data);
    if (decision === "deny") {
      const message =
        "Permission denied by the user. Do not retry this exact action; ask what to do instead or try another approach.";
      bus.emit({
        type: "tool-result",
        id: call.toolCallId,
        name: call.toolName,
        output: message,
        isError: true,
      });
      return asResult(`DENIED: ${message}`);
    }

    try {
      let output = await toolDef.execute(parsed.data, this.ctx);
      const cap = this.opts.profile.maxToolResultChars;
      if (output.length > cap) {
        const spillPath = `${this.opts.spillDir}/${call.toolName.toLowerCase()}-${call.toolCallId}.txt`;
        await Bun.write(spillPath, output);
        output =
          output.slice(0, cap) +
          `\n[result truncated at ${cap} chars — full output saved to ${spillPath}]`;
      }
      // Ground truth after code edits: typecheck + token lint, appended past
      // the cap so diagnostics (already bounded) are never truncated away.
      if (call.toolName === "Edit" || call.toolName === "Write") {
        const fp = (parsed.data as { file_path?: unknown }).file_path;
        if (typeof fp === "string") {
          const checked = await runPostEditChecks(resolvePath(fp, this.ctx), this.ctx);
          if (checked) output += `\n\n${checked}`;
        }
      }
      bus.emit({
        type: "tool-result",
        id: call.toolCallId,
        name: call.toolName,
        output,
        isError: false,
      });
      return asResult(output);
    } catch (err) {
      const message = describeError(err);
      bus.emit({
        type: "tool-result",
        id: call.toolCallId,
        name: call.toolName,
        output: message,
        isError: true,
      });
      return asResult(`ERROR: ${message}`);
    }
  }

  private async checkPermission(
    toolDef: ToolDef,
    specifier: string,
    input: unknown,
  ): Promise<"allow" | "deny"> {
    const { settings, bus } = this.opts;
    const decision = evaluatePermission(toolDef, specifier, settings);
    if (decision !== "ask") return decision;

    return new Promise((resolve) => {
      bus.emit({
        type: "permission-request",
        id: crypto.randomUUID(),
        name: toolDef.name,
        specifier,
        input,
        respond: (choice) => {
          if (choice === "deny") return resolve("deny");
          if (choice === "always") {
            const rule = ruleForAlways(toolDef.name, specifier);
            settings.allow.push(rule);
            void persistAllowRule(this.opts.cwd, rule);
          }
          resolve("allow");
        },
      });
    });
  }

  /**
   * Stage-1 context management: when estimated tokens approach the profile's
   * context limit, elide the oldest tool results. Full compaction lands in M3.
   */
  private trimHistory(): void {
    const budgetChars = this.opts.profile.contextLength * 3;
    const size = () => JSON.stringify(this.messages).length;
    if (size() <= budgetChars) return;
    for (const message of this.messages) {
      if (message.role !== "tool" || !Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type === "tool-result" && part.output.type === "text") {
          part.output = {
            type: "text",
            value: "[old tool result elided to save context]",
          };
        }
      }
      if (size() <= budgetChars * 0.7) break;
    }
  }
}
