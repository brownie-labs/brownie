import { defineCommand } from "citty";
import {
  fail,
  readTextSource,
  requestControl,
  SOCKET_ENV_HINT,
  writerFor,
  type ControlCommandIo,
} from "./control-commands.js";
import { logger } from "./logger.js";

export async function runContextGet(
  options: { json?: boolean | undefined } & ControlCommandIo = {},
): Promise<void> {
  const response = await requestControl({ cmd: "context.get" }, options);
  if (response === null) return;
  const write = writerFor(options);
  write(
    options.json === true
      ? JSON.stringify(response.data, null, 2)
      : response.data.content,
  );
}

export async function runContextSet(
  source: string | undefined,
  options: ControlCommandIo = {},
): Promise<void> {
  let content: string | null;
  try {
    content = await readTextSource(source, options);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }
  if (content === null) return;
  const response = await requestControl({ cmd: "context.set", content }, options);
  if (response === null) return;
  logger.success(
    content.trim() === "" ? "Cleared the context file." : "Updated the context file.",
  );
}

export const contextCommand = defineCommand({
  meta: {
    name: "context",
    description: `Read and replace the workspace context of the running worker. ${SOCKET_ENV_HINT}`,
  },
  subCommands: {
    get: defineCommand({
      meta: { name: "get", description: "Print the context file" },
      args: {
        json: { type: "boolean", description: "Print JSON instead of the raw context" },
      },
      run: ({ args }) => runContextGet({ json: args.json }),
    }),
    set: defineCommand({
      meta: {
        name: "set",
        description:
          "Replace the context file from a file or stdin; empty input clears it",
      },
      args: {
        file: {
          type: "positional",
          required: false,
          description: "Markdown file to read (default: stdin, also with -)",
        },
      },
      run: ({ args }) => runContextSet(args.file),
    }),
  },
});
