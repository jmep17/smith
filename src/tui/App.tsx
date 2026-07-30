import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AgentSession } from "../agent/loop.ts";
import { describeError } from "../errors.ts";
import type { Profile } from "../provider/profiles.ts";
import { PermissionPrompt } from "./PermissionPrompt.tsx";
import type { TuiStore } from "./store.ts";
import { Transcript } from "./Transcript.tsx";

const SLASH_HELP = `commands:
  /help     show this help
  /clear    clear the conversation
  /compact  summarize the conversation to free context
  /model    show profile and model
  /quit     exit (also: ctrl+c, ctrl+d)
esc interrupts a running turn`;

export interface AppProps {
  session: AgentSession;
  store: TuiStore;
  profile: Profile;
}

export function App({ session, store, profile }: AppProps) {
  const { exit } = useApp();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useInput((char, key) => {
    if (key.escape && snapshot.busy && !snapshot.permission) {
      abortRef.current?.abort();
    }
    // Some terminals/PTYs deliver newline instead of carriage return for
    // Enter; ink-text-input only submits on return, so cover LF here.
    if (char === "\n" && !snapshot.busy && !snapshot.permission) {
      void submit(input);
    }
  });

  const submit = async (raw: string) => {
    const text = raw.trim();
    setInput("");
    if (!text) return;

    if (text.startsWith("/")) {
      switch (text.split(/\s+/)[0]) {
        case "/help":
          store.addInfo(SLASH_HELP);
          return;
        case "/clear":
          session.messages.length = 0;
          store.clear();
          store.addInfo("conversation cleared");
          return;
        case "/model":
          store.addInfo(
            `profile ${profile.name}: ${profile.model} (ctx ${profile.contextLength.toLocaleString()}, temp ${profile.temperature})`,
          );
          return;
        case "/compact": {
          store.addInfo("compacting…");
          try {
            await session.compact();
            store.addInfo("conversation compacted");
          } catch (err) {
            store.addError(`compact failed: ${describeError(err)}`);
          }
          return;
        }
        case "/quit":
        case "/exit":
          exit();
          return;
        default:
          store.addInfo(`unknown command: ${text} — try /help`);
          return;
      }
    }

    store.addUser(text);
    const controller = new AbortController();
    abortRef.current = controller;
    session.setAbortSignal(controller.signal);
    try {
      await session.run(text);
      store.turnDone();
    } catch (err) {
      if (controller.signal.aborted) {
        store.addInfo("interrupted");
        store.turnDone();
      } else {
        store.addError(describeError(err));
      }
    } finally {
      abortRef.current = null;
    }
  };

  const header = useMemo(
    () => (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="magenta">
          smith
        </Text>
        <Text dimColor>
          {profile.model} · profile {profile.name} · /help for commands
        </Text>
      </Box>
    ),
    [profile],
  );

  return (
    <Box flexDirection="column">
      {header}
      <Transcript items={snapshot.items} />
      {snapshot.permission ? (
        <Box marginTop={1}>
          <PermissionPrompt request={snapshot.permission} />
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color="blue" bold>
            ❯{" "}
          </Text>
          {snapshot.busy ? (
            <Text dimColor>working… step {snapshot.step} (esc to interrupt)</Text>
          ) : (
            <TextInput value={input} onChange={setInput} onSubmit={submit} />
          )}
        </Box>
      )}
      <ContextMeter session={session} busy={snapshot.busy} />
    </Box>
  );
}

function ContextMeter({ session, busy }: { session: AgentSession; busy: boolean }) {
  const { tokens, limit, fraction } = session.usage();
  if (tokens < 100) return null;
  const pct = Math.min(100, Math.round(fraction * 100));
  return (
    <Text dimColor>
      ctx ~{tokens.toLocaleString()}/{limit.toLocaleString()} ({pct}%)
      {busy ? "" : pct > 70 ? " — consider /compact" : ""}
    </Text>
  );
}
