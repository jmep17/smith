import { generateText, type ModelMessage } from "ai";
import { smallModel } from "../provider/client.ts";
import type { Profile } from "../provider/profiles.ts";

/** Rough token estimate: ~4 chars per token on code-heavy text. */
export function estimateTokens(messages: ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

function renderForSummary(messages: ModelMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      lines.push(`${m.role}: ${m.content}`);
      continue;
    }
    for (const part of m.content) {
      if (part.type === "text") lines.push(`${m.role}: ${part.text}`);
      else if (part.type === "tool-call")
        lines.push(
          `${m.role} called ${part.toolName}(${JSON.stringify(part.input).slice(0, 200)})`,
        );
      else if (part.type === "tool-result" && part.output.type === "text")
        lines.push(`tool ${part.toolName} → ${String(part.output.value).slice(0, 300)}`);
    }
  }
  return lines.join("\n").slice(0, 60_000);
}

/**
 * Full compaction: replace the conversation with a model-written summary
 * that preserves task state, decisions, and file paths.
 */
export async function compactMessages(
  messages: ModelMessage[],
  profile: Profile,
): Promise<ModelMessage[]> {
  const { text } = await generateText({
    model: smallModel(profile),
    prompt: `Summarize this coding-agent session so the agent can seamlessly continue working. Preserve: the user's goal and any open tasks, key decisions made, files created/modified (exact paths), important code details or errors encountered, and what should happen next. Be dense and factual, under 500 words.\n\nSession transcript:\n${renderForSummary(messages)}`,
    temperature: 0.2,
  });
  return [
    {
      role: "user",
      content: `[Earlier conversation was compacted. Summary of the session so far:]\n${text}`,
    },
  ];
}
