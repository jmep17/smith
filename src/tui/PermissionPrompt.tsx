import * as Diff from "diff";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { ruleForAlways } from "../permissions/engine.ts";
import type { PendingPermission } from "./store.ts";

const CHOICES = [
  { key: "once", label: "Yes, once" },
  { key: "always", label: "Yes, and don't ask again" },
  { key: "deny", label: "No (esc)" },
] as const;

function EditPreview({ input }: { input: unknown }) {
  const { old_string, new_string } = input as {
    old_string?: string;
    new_string?: string;
    content?: string;
  };
  const oldText = old_string ?? "";
  const newText = new_string ?? (input as { content?: string }).content ?? "";
  const parts = Diff.diffLines(
    oldText.endsWith("\n") ? oldText : `${oldText}\n`,
    newText.endsWith("\n") ? newText : `${newText}\n`,
  );
  const lines = parts.flatMap((part) => {
    const prefix = part.added ? "+" : part.removed ? "-" : " ";
    const color = part.added ? "green" : part.removed ? "red" : undefined;
    return part.value
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => ({ text: `${prefix} ${line}`, color }));
  });
  const shown = lines.slice(0, 20);
  return (
    <Box flexDirection="column" marginLeft={2}>
      {shown.map((line, i) => (
        <Text key={i} color={line.color} dimColor={!line.color}>
          {line.text}
        </Text>
      ))}
      {lines.length > shown.length && (
        <Text dimColor>… {lines.length - shown.length} more lines</Text>
      )}
    </Box>
  );
}

export function PermissionPrompt({ request }: { request: PendingPermission }) {
  const [selected, setSelected] = useState(0);

  useInput((inputChar, key) => {
    if (key.upArrow) setSelected((s) => (s + CHOICES.length - 1) % CHOICES.length);
    else if (key.downArrow) setSelected((s) => (s + 1) % CHOICES.length);
    else if (key.return) request.respond(CHOICES[selected]!.key);
    else if (key.escape || inputChar === "n") request.respond("deny");
    else if (inputChar === "y") request.respond("once");
    else if (inputChar === "a") request.respond("always");
  });

  const isEditLike = request.name === "Edit" || request.name === "Write";
  const spec =
    request.specifier.length > 200
      ? `${request.specifier.slice(0, 200)}…`
      : request.specifier;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">
        Permission: {request.name}
      </Text>
      <Text>{spec}</Text>
      {isEditLike && <EditPreview input={request.input} />}
      <Box flexDirection="column" marginTop={1}>
        {CHOICES.map((choice, i) => (
          <Text key={choice.key} color={i === selected ? "cyan" : undefined}>
            {i === selected ? "❯ " : "  "}
            {choice.label}
            {choice.key === "always" && (
              <Text dimColor> [{ruleForAlways(request.name, request.specifier)}]</Text>
            )}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
