// UI-agnostic event bus. The agent loop emits; the TUI or headless printer
// subscribes. Keeping the loop free of any UI import is what lets the same
// core power -p mode, tests, and Ink.

export type AgentEvent =
  | { type: "step-start"; step: number }
  | { type: "text-delta"; text: string }
  | { type: "text-end" }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; input: unknown; specifier: string }
  | { type: "tool-result"; id: string; name: string; output: string; isError: boolean }
  | { type: "repair"; message: string }
  | { type: "info"; message: string }
  | {
      type: "permission-request";
      id: string;
      name: string;
      specifier: string;
      input: unknown;
      respond: (decision: "once" | "always" | "deny") => void;
    }
  | { type: "turn-end"; text: string; steps: number }
  | { type: "error"; message: string };

export type AgentEventListener = (event: AgentEvent) => void;

export class AgentBus {
  private listeners = new Set<AgentEventListener>();

  on(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
