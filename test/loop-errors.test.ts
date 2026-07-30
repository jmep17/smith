import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { AgentSession } from "../src/agent/loop.ts";
import { AgentBus, type AgentEvent } from "../src/events.ts";
import { getProfile } from "../src/provider/profiles.ts";

/** The exact payload LM Studio emits when its runtime drops a stream. */
const COMPUTE_ERROR = {
  message:
    'Engine protocol predict stream returned an error: {"code":500,"message":"Compute error.","type":"server_error"}',
};

type StreamPart = Record<string, unknown>;

function stream(parts: StreamPart[]) {
  return {
    stream: simulateReadableStream({ chunks: parts as never, chunkDelayInMs: 0 }),
  };
}

const textStream = (text: string) =>
  stream([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "1" },
    { type: "text-delta", id: "1", delta: text },
    { type: "text-end", id: "1" },
    {
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    },
  ]);

const errorStream = (error: unknown, before: StreamPart[] = []) =>
  stream([
    { type: "stream-start", warnings: [] },
    ...before,
    { type: "error", error },
    {
      type: "finish",
      finishReason: "error",
      usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
    },
  ]);

async function runWith(doStream: unknown[]) {
  const cwd = await mkdtemp(join(tmpdir(), "smith-loop-"));
  const bus = new AgentBus();
  const events: AgentEvent[] = [];
  bus.on((e) => events.push(e));
  const model = new MockLanguageModelV4({ doStream: doStream as never });
  const session = new AgentSession({
    cwd,
    profile: getProfile("m4"),
    settings: { allow: [], deny: [] },
    bus,
    spillDir: cwd,
    model,
  });
  return { session, events, model };
}

describe("stream error handling", () => {
  test("surfaces a readable message instead of [object Object]", async () => {
    const { session } = await runWith([
      errorStream(COMPUTE_ERROR),
      errorStream(COMPUTE_ERROR),
      errorStream(COMPUTE_ERROR),
    ]);

    const err = (await session.run("hi").catch((e) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain("[object Object]");
    expect(err.message).toContain("Compute error.");
    expect(err.message).toContain("hint:");
  });

  test("retries a transient engine error and completes the turn", async () => {
    const { session, events, model } = await runWith([
      errorStream(COMPUTE_ERROR),
      textStream("recovered"),
    ]);

    expect(await session.run("hi")).toBe("recovered");
    expect(model.doStreamCalls.length).toBe(2);
    expect(events.some((e) => e.type === "info" && e.message.includes("retrying"))).toBe(
      true,
    );
  });

  test("gives up after the retry budget", async () => {
    const { session, model } = await runWith([
      errorStream(COMPUTE_ERROR),
      errorStream(COMPUTE_ERROR),
      errorStream(COMPUTE_ERROR),
      textStream("never reached"),
    ]);

    await expect(session.run("hi")).rejects.toThrow(/Compute error/);
    expect(model.doStreamCalls.length).toBe(3);
  });

  test("does not retry once the model has produced output", async () => {
    const { session, model } = await runWith([
      errorStream(COMPUTE_ERROR, [
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: "partial" },
      ]),
      textStream("never reached"),
    ]);

    await expect(session.run("hi")).rejects.toThrow(/Compute error/);
    expect(model.doStreamCalls.length).toBe(1);
  });

  test("does not retry a client-side error", async () => {
    const { session, model } = await runWith([
      errorStream({ message: "model 'nope' not found", code: 404 }),
      textStream("never reached"),
    ]);

    await expect(session.run("hi")).rejects.toThrow(/not found/);
    expect(model.doStreamCalls.length).toBe(1);
  });
});
