import { defineCommand } from "citty";
import { readFile } from "node:fs/promises";
import {
  fail,
  readStdinText,
  requestControl,
  SOCKET_ENV_HINT,
  writerFor,
  type ControlCommandIo,
} from "./control-commands.js";
import { logger } from "./logger.js";
import { PROMPT_AGENTS, type PromptAgent } from "./prompt-files.js";

function parseAgent(raw: string): PromptAgent | null {
  return PROMPT_AGENTS.find((agent) => agent === raw) ?? null;
}

function unknownAgent(raw: string): string {
  return `Unknown agent "${raw}" — use ${PROMPT_AGENTS.join(" or ")}.`;
}

export async function runPromptGet(
  agentArg: string,
  options: { json?: boolean | undefined } & ControlCommandIo = {},
): Promise<void> {
  const agent = parseAgent(agentArg);
  if (agent === null) {
    fail(unknownAgent(agentArg));
    return;
  }
  const response = await requestControl({ cmd: "prompt.get", agent }, options);
  if (response === null) return;
  const write = writerFor(options);
  write(
    options.json === true
      ? JSON.stringify(response.data, null, 2)
      : response.data.content,
  );
}

async function readPromptSource(
  source: string | undefined,
  options: ControlCommandIo,
): Promise<string | null> {
  if (source === undefined || source === "-") {
    return (options.readStdin ?? readStdinText)();
  }
  try {
    return await readFile(source, "utf8");
  } catch {
    fail(`Cannot read "${source}".`);
    return null;
  }
}

export async function runPromptSet(
  agentArg: string,
  source: string | undefined,
  options: ControlCommandIo = {},
): Promise<void> {
  const agent = parseAgent(agentArg);
  if (agent === null) {
    fail(unknownAgent(agentArg));
    return;
  }
  let content: string | null;
  try {
    content = await readPromptSource(source, options);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }
  if (content === null) return;
  if (content.trim() === "") {
    fail("The prompt content is empty.");
    return;
  }
  const response = await requestControl({ cmd: "prompt.set", agent, content }, options);
  if (response === null) return;
  logger.success(`Updated the ${agent} prompt.`);
}

export const promptCommand = defineCommand({
  meta: {
    name: "prompt",
    description: `Read and replace the project prompts of the running worker. ${SOCKET_ENV_HINT}`,
  },
  subCommands: {
    get: defineCommand({
      meta: { name: "get", description: "Print a project prompt" },
      args: {
        agent: {
          type: "positional",
          required: true,
          description: PROMPT_AGENTS.join(" or "),
        },
        json: { type: "boolean", description: "Print JSON instead of the raw prompt" },
      },
      run: ({ args }) => runPromptGet(args.agent, { json: args.json }),
    }),
    set: defineCommand({
      meta: {
        name: "set",
        description:
          "Replace a project prompt from a file or stdin; the next session uses it",
      },
      args: {
        agent: {
          type: "positional",
          required: true,
          description: PROMPT_AGENTS.join(" or "),
        },
        file: {
          type: "positional",
          required: false,
          description: "Markdown file to read (default: stdin, also with -)",
        },
      },
      run: ({ args }) => runPromptSet(args.agent, args.file),
    }),
  },
});
