import { describe, expect, test } from "bun:test";
import {
  describeError,
  engineErrorHint,
  isTransientEngineError,
  toError,
} from "../src/errors.ts";

describe("describeError", () => {
  test("never yields [object Object] for a plain payload", () => {
    // Exactly what LM Studio puts on the wire when the runtime dies mid-stream.
    const payload = {
      message:
        'Engine protocol predict stream returned an error: {"code":500,"message":"Compute error.","type":"server_error"}',
    };
    const described = describeError(payload);
    expect(described).not.toContain("[object Object]");
    expect(described).toContain("Engine protocol predict stream returned an error");
    // The embedded JSON blob is unwrapped down to the actual reason.
    expect(described).toContain("Compute error.");
    expect(described).not.toContain('{"code"');
  });

  test("reads Error instances and their causes", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    const wrapped = new Error("model call failed", {
      cause: { message: "Compute error.", code: 500 },
    });
    expect(describeError(wrapped)).toBe("model call failed: Compute error. (500)");
  });

  test("does not duplicate a cause already quoted in the outer message", () => {
    const wrapped = new Error("failed: inner detail", {
      cause: new Error("inner detail"),
    });
    expect(describeError(wrapped)).toBe("failed: inner detail");
  });

  test("digs through nested provider envelopes", () => {
    expect(describeError({ error: { message: "model not loaded" } })).toBe(
      "model not loaded",
    );
    expect(describeError({ error: "bad request", status: 400 })).toBe(
      "bad request (400)",
    );
  });

  test("keeps a status marker only when it adds information", () => {
    expect(describeError({ message: "boom", code: 500 })).toBe("boom (500)");
    expect(describeError({ message: "server responded 500", code: 500 })).toBe(
      "server responded 500",
    );
  });

  test("falls back to the payload rather than a useless placeholder", () => {
    expect(describeError({ weird: "shape" })).toBe('{"weird":"shape"}');
    expect(describeError(null)).toBe("unknown error");
    expect(describeError({})).toBe("unknown error");
    expect(describeError(["a", { message: "b" }])).toBe("a; b");
  });

  test("survives circular payloads", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular)).toBe("unknown error");
  });
});

describe("toError", () => {
  test("wraps non-Errors while keeping the raw payload", () => {
    const payload = { message: "Compute error." };
    const err = toError(payload);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Compute error.");
    expect(err.cause).toBe(payload);
  });

  test("passes Errors through untouched", () => {
    const original = new Error("nope");
    expect(toError(original)).toBe(original);
  });
});

describe("isTransientEngineError", () => {
  test("retries engine/runtime hiccups", () => {
    expect(
      isTransientEngineError({
        message:
          'Engine protocol predict stream returned an error: {"code":500,"message":"Compute error.","type":"server_error"}',
      }),
    ).toBe(true);
    expect(isTransientEngineError(new Error("socket hang up"))).toBe(true);
    expect(isTransientEngineError(new Error("fetch failed"))).toBe(true);
    expect(isTransientEngineError(new Error("request timed out"))).toBe(true);
  });

  test("does not retry client-side mistakes", () => {
    expect(isTransientEngineError(new Error("400 model 'nope' not found"))).toBe(false);
    expect(isTransientEngineError(new Error("invalid tool arguments"))).toBe(false);
    expect(isTransientEngineError(new Error("429 rate limited"))).toBe(true);
  });
});

describe("engineErrorHint", () => {
  test("explains the compute error users actually hit", () => {
    const hint = engineErrorHint({ message: "Compute error." });
    expect(hint).toContain("/compact");
  });

  test("stays quiet when it has nothing useful to add", () => {
    expect(engineErrorHint(new Error("something else"))).toBeNull();
  });
});
