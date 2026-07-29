import { Box, Text } from "ink";
import { renderMarkdown } from "./markdown.ts";
import type { TranscriptItem } from "./store.ts";

function ToolCard({ item }: { item: Extract<TranscriptItem, { kind: "tool" }> }) {
  const spec =
    item.specifier.length > 100 ? `${item.specifier.slice(0, 100)}…` : item.specifier;
  const preview = (() => {
    if (item.output === null) return null;
    const lines = item.output.split("\n");
    const first = lines[0] ?? "";
    const head = first.length > 120 ? `${first.slice(0, 120)}…` : first;
    return lines.length > 1 ? `${head} (+${lines.length - 1} lines)` : head;
  })();
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color="cyan">
          ⏺ {item.name}
        </Text>
        <Text dimColor>({spec})</Text>
        {item.output === null && <Text color="yellow"> …</Text>}
      </Text>
      {preview !== null && (
        <Text color={item.isError ? "red" : undefined} dimColor={!item.isError}>
          {"  ⎿ "}
          {preview}
        </Text>
      )}
    </Box>
  );
}

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="blue" bold>
            ❯{" "}
          </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={1}>
          <Text>{item.streaming ? item.text : renderMarkdown(item.text)}</Text>
        </Box>
      );
    case "tool":
      return <ToolCard item={item} />;
    case "info":
      return <Text dimColor>· {item.text}</Text>;
    case "error":
      return <Text color="red">✗ {item.text}</Text>;
  }
}

export function Transcript({ items }: { items: TranscriptItem[] }) {
  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Item key={i} item={item} />
      ))}
    </Box>
  );
}
