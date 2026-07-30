// Turning arbitrary thrown values into something a human can read.
//
// The AI SDK surfaces provider stream failures as whatever the server put on
// the wire — for LM Studio that is a bare `{ message: "..." }`, not an Error.
// `String(value)` on that yields "[object Object]", which is how engine
// failures used to reach the transcript. Everything that renders an error
// goes through describeError() instead.

const MESSAGE_KEYS = ["message", "error", "detail", "reason", "description"] as const;

/** Best-effort human-readable message for any thrown/emitted value. */
export function describeError(value: unknown, depth = 0): string {
  if (value == null) return "unknown error";
  if (typeof value === "string") return unwrapJson(value.trim()) || "unknown error";
  if (typeof value !== "object") return String(value);

  if (value instanceof Error) {
    // AI SDK errors chain the provider payload on `cause`; prefer the inner
    // detail when the outer message is a generic wrapper.
    const own = value.message.trim();
    const cause = "cause" in value ? value.cause : undefined;
    if (cause != null && depth < 4) {
      const inner = describeError(cause, depth + 1);
      if (inner && inner !== "unknown error" && !own.includes(inner)) {
        return own ? `${own}: ${inner}` : inner;
      }
    }
    if (own) return unwrapJson(own);
    return value.name || "unknown error";
  }

  if (Array.isArray(value)) {
    const parts = value.map((v) => describeError(v, depth + 1)).filter(Boolean);
    return parts.join("; ") || "unknown error";
  }

  const record = value as Record<string, unknown>;
  for (const key of MESSAGE_KEYS) {
    const nested = record[key];
    if (typeof nested === "string" && nested.trim()) {
      return decorate(unwrapJson(nested.trim()), record);
    }
    if (nested != null && typeof nested === "object" && depth < 4) {
      return decorate(describeError(nested, depth + 1), record);
    }
  }

  // No message-ish field: fall back to the payload itself rather than
  // "[object Object]".
  try {
    const json = JSON.stringify(value);
    if (json && json !== "{}") return json;
  } catch {
    // circular or otherwise unserialisable — fall through
  }
  return "unknown error";
}

/** Append a status/type marker when the message alone doesn't carry it. */
function decorate(message: string, record: Record<string, unknown>): string {
  const status = record.status ?? record.statusCode ?? record.code;
  if (
    (typeof status === "number" || typeof status === "string") &&
    !message.includes(String(status))
  ) {
    return `${message} (${status})`;
  }
  return message;
}

/**
 * Providers often embed a JSON error blob inside the message string, e.g.
 * `Engine ... returned an error: {"code":500,"message":"Compute error."}`.
 * Pull the inner message out so the transcript shows the actual reason.
 */
function unwrapJson(message: string): string {
  const start = message.indexOf("{");
  if (start === -1 || !message.endsWith("}")) return message;
  try {
    const parsed = JSON.parse(message.slice(start));
    if (parsed && typeof parsed === "object") {
      const inner = describeError(parsed, 3);
      if (inner && inner !== "unknown error") {
        const prefix = message.slice(0, start).replace(/[:\s]+$/, "");
        return prefix ? `${prefix}: ${inner}` : inner;
      }
    }
  } catch {
    // not JSON after all — keep the original text
  }
  return message;
}

/** Coerce any thrown value into a real Error, preserving the readable text. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  const err = new Error(describeError(value));
  // Keep the raw payload reachable for callers that want to inspect it.
  (err as Error & { cause?: unknown }).cause = value;
  return err;
}

const TRANSIENT_PATTERNS = [
  /\bcompute error\b/i,
  /\bserver_error\b/i,
  /\bengine (protocol|error)/i,
  /\bpredict stream\b/i,
  /\b(50[0-9])\b/,
  /\boverloaded\b/i,
  /\brate.?limit/i,
  /\btimed? ?out\b/i,
  /\bsocket hang up\b/i,
  /\bECONNRESET\b/,
  /\bECONNREFUSED\b/,
  /\bEPIPE\b/,
  /fetch failed/i,
];

/**
 * True for engine-side hiccups worth retrying: LM Studio's model runtime
 * occasionally drops a stream with a 500 "Compute error" that succeeds on a
 * second attempt. Deliberately excludes 4xx (bad request, model not loaded).
 */
export function isTransientEngineError(value: unknown): boolean {
  const message = describeError(value);
  if (/\b4\d\d\b/.test(message) && !/\b(408|429)\b/.test(message)) return false;
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

/** Actionable follow-up for the failures users actually hit locally. */
export function engineErrorHint(value: unknown): string | null {
  const message = describeError(value);
  if (/compute error|predict stream|engine (protocol|error)/i.test(message)) {
    return (
      "the model runtime failed mid-generation — usually GPU/VRAM pressure or a " +
      "context overflow. Try /compact, a shorter turn, or reload the model in LM Studio."
    );
  }
  if (/ECONNREFUSED|fetch failed|socket hang up/i.test(message)) {
    return "LM Studio looks unreachable — check that the server is still running.";
  }
  if (/context length|too many tokens|exceeds/i.test(message)) {
    return "the request outgrew the model's context window — run /compact and retry.";
  }
  return null;
}
