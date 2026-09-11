import { defineCommand } from "citty";
import {
  fail,
  readStdinText,
  requestControl,
  SOCKET_ENV_HINT,
  writerFor,
  type ControlCommandIo,
} from "./control-commands.js";
import { logger } from "./logger.js";
import { isPlainObject, type SettingsPatch } from "./settings-file.js";

export function flattenSettings(
  value: Record<string, unknown>,
  prefix = "",
): [string, string][] {
  const lines: [string, string][] = [];
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isPlainObject(entry)) {
      lines.push(...flattenSettings(entry, path));
    } else {
      lines.push([path, JSON.stringify(entry)]);
    }
  }
  return lines;
}

export async function runSettingsGet(
  options: { json?: boolean | undefined } & ControlCommandIo = {},
): Promise<void> {
  const write = writerFor(options);
  const response = await requestControl({ cmd: "settings.get" }, options);
  if (response === null) return;
  if (options.json === true) {
    write(JSON.stringify(response.data, null, 2));
    return;
  }
  for (const [path, value] of flattenSettings(response.data)) write(`${path} = ${value}`);
}

async function resolvePatchSource(
  source: string,
  options: ControlCommandIo,
): Promise<string> {
  if (source !== "-") return source;
  return (options.readStdin ?? readStdinText)();
}

export async function runSettingsPatch(
  source: string,
  options: { json?: boolean | undefined } & ControlCommandIo = {},
): Promise<void> {
  let patch: unknown;
  try {
    patch = JSON.parse(await resolvePatchSource(source, options));
  } catch (err) {
    fail(`Invalid JSON patch: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!isPlainObject(patch)) {
    fail("The patch must be a JSON object.");
    return;
  }
  const response = await requestControl(
    { cmd: "settings.patch", patch: patch as SettingsPatch },
    options,
  );
  if (response === null) return;
  if (options.json === true) {
    writerFor(options)(JSON.stringify(response.data, null, 2));
    return;
  }
  logger.success("Settings updated.");
}

export const settingsCommand = defineCommand({
  meta: {
    name: "settings",
    description: `Read and change the running worker's settings without a restart. ${SOCKET_ENV_HINT}`,
  },
  subCommands: {
    get: defineCommand({
      meta: { name: "get", description: "Print the effective settings" },
      args: {
        json: { type: "boolean", description: "Print JSON instead of dotted lines" },
      },
      run: ({ args }) => runSettingsGet({ json: args.json }),
    }),
    patch: defineCommand({
      meta: {
        name: "patch",
        description:
          "Merge a sparse JSON patch into settings.json (null deletes a key); the worker applies it live",
      },
      args: {
        patch: {
          type: "positional",
          required: true,
          description: "JSON object, or - to read it from stdin",
        },
        json: { type: "boolean", description: "Print the resulting settings as JSON" },
      },
      run: ({ args }) => runSettingsPatch(args.patch, { json: args.json }),
    }),
  },
});
