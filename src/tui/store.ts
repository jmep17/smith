// Bridges AgentBus events into a snapshot React can consume via
// useSyncExternalStore. Keeps the agent loop free of React.

import type { AgentBus, AgentEvent } from "../events.ts";

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      name: string;
      specifier: string;
      input: unknown;
      output: string | null;
      isError: boolean;
    }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string };

export interface PendingPermission {
  id: string;
  name: string;
  specifier: string;
  input: unknown;
  respond: (decision: "once" | "always" | "deny") => void;
}

export interface Snapshot {
  items: TranscriptItem[];
  permission: PendingPermission | null;
  busy: boolean;
  step: number;
}

export class TuiStore {
  private items: TranscriptItem[] = [];
  private permission: PendingPermission | null = null;
  private busy = false;
  private step = 0;
  private snapshot: Snapshot = { items: [], permission: null, busy: false, step: 0 };
  private listeners = new Set<() => void>();

  constructor(bus: AgentBus) {
    bus.on((event) => this.onEvent(event));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  addUser(text: string): void {
    this.items.push({ kind: "user", text });
    this.busy = true;
    this.step = 0;
    this.publish();
  }

  addInfo(text: string): void {
    this.items.push({ kind: "info", text });
    this.publish();
  }

  addError(text: string): void {
    // Close any half-streamed assistant block first, otherwise it stays in
    // raw (unrendered) form for the rest of the session.
    this.closeStream();
    this.items.push({ kind: "error", text });
    this.busy = false;
    this.publish();
  }

  turnDone(): void {
    this.busy = false;
    this.closeStream();
    this.publish();
  }

  clear(): void {
    this.items = [];
    this.busy = false;
    this.permission = null;
    this.publish();
  }

  private closeStream(): void {
    const last = this.items.at(-1);
    if (last?.kind === "assistant") last.streaming = false;
  }

  private onEvent(event: AgentEvent): void {
    switch (event.type) {
      case "step-start":
        this.step = event.step;
        break;
      case "text-delta": {
        const last = this.items.at(-1);
        if (last?.kind === "assistant" && last.streaming) {
          last.text += event.text;
        } else {
          this.items.push({ kind: "assistant", text: event.text, streaming: true });
        }
        break;
      }
      case "text-end":
        this.closeStream();
        break;
      case "tool-call":
        this.closeStream();
        this.items.push({
          kind: "tool",
          id: event.id,
          name: event.name,
          specifier: event.specifier,
          input: event.input,
          output: null,
          isError: false,
        });
        break;
      case "tool-result": {
        const item = this.items.findLast((i) => i.kind === "tool" && i.id === event.id);
        if (item?.kind === "tool") {
          item.output = event.output;
          item.isError = event.isError;
        }
        break;
      }
      case "repair":
        this.items.push({ kind: "info", text: `repairing tool call: ${event.message}` });
        break;
      case "info":
        this.items.push({ kind: "info", text: event.message });
        break;
      case "permission-request":
        this.permission = {
          id: event.id,
          name: event.name,
          specifier: event.specifier,
          input: event.input,
          respond: (decision) => {
            this.permission = null;
            this.publish();
            event.respond(decision);
          },
        };
        break;
      case "turn-end":
        this.busy = false;
        this.closeStream();
        break;
      case "error":
        this.closeStream();
        this.items.push({ kind: "error", text: event.message });
        break;
    }
    this.publish();
  }

  private publish(): void {
    this.snapshot = {
      items: [...this.items],
      permission: this.permission,
      busy: this.busy,
      step: this.step,
    };
    for (const listener of this.listeners) listener();
  }
}
