import { readdir } from "node:fs/promises";
import type { ModelMessage } from "ai";

export const SESSION_DIR = `${process.env.HOME}/.local/share/smith/sessions`;

/** Most recently modified session file, or null. */
export async function latestSessionFile(): Promise<string | null> {
  try {
    const names = (await readdir(SESSION_DIR)).filter((n) => n.endsWith(".jsonl"));
    if (names.length === 0) return null;
    // Filenames start with an ISO timestamp, so lexical sort is chronological.
    names.sort();
    return `${SESSION_DIR}/${names.at(-1)}`;
  } catch {
    return null;
  }
}

export async function loadSessionMessages(path: string): Promise<ModelMessage[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`session file not found: ${path}`);
  const messages: ModelMessage[] = [];
  for (const line of (await file.text()).split("\n")) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as ModelMessage);
    } catch {
      // skip corrupt lines rather than losing the whole session
    }
  }
  return messages;
}
