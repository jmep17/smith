import { marked } from "marked";
// @ts-expect-error marked-terminal ships no types for the marked v12+ plugin API
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal({ reflowText: false }) as Parameters<typeof marked.use>[0]);

export function renderMarkdown(text: string): string {
  try {
    return (marked.parse(text) as string).trimEnd();
  } catch {
    return text;
  }
}
