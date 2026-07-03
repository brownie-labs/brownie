import { Box, Text } from "ink";
import type { JSX } from "react";
import type { TaskSummaryRecord } from "../../memory/store.js";
import { formatAge } from "../format.js";
import { theme } from "../theme.js";

export interface MemoryViewProps {
  entries: readonly TaskSummaryRecord[];
  query?: string | undefined;
  height: number;
  now: number;
}

export function MemoryView({
  entries,
  query,
  height,
  now,
}: MemoryViewProps): JSX.Element {
  const maxRows = Math.max(1, height - 3);
  const overflow = entries.length > maxRows ? entries.length - (maxRows - 1) : 0;
  const visible = overflow > 0 ? entries.slice(0, maxRows - 1) : entries;
  return (
    <Box
      borderStyle="round"
      borderColor={theme.muted}
      flexDirection="column"
      paddingX={1}
      height={height}
      overflow="hidden"
    >
      <Text bold wrap="truncate-end">
        {query === undefined
          ? "Memory · recent entries"
          : `Memory · search "${query}" · ${entries.length} results`}
      </Text>
      {entries.length === 0 ? (
        <Text dimColor>
          {query === undefined ? "no memory entries yet" : "no matching entries"}
        </Text>
      ) : null}
      {visible.map((entry) => (
        <Text key={entry.id} wrap="truncate-end">
          <Text color={entry.ok ? theme.ok : theme.error}>{entry.ok ? "✔ " : "✖ "}</Text>
          {`${entry.taskId} · ${entry.headline}`}
          <Text dimColor>
            {` · ${formatAge(entry.createdAt, now)}` +
              (entry.attempt > 1 ? ` · attempt ${entry.attempt}` : "")}
          </Text>
        </Text>
      ))}
      {overflow > 0 ? <Text dimColor>… and {overflow} more</Text> : null}
    </Box>
  );
}
