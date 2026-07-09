import { z } from "zod";

const REGISTRY_BASE_URL = "https://registry.npmjs.org";
const DEFAULT_TIMEOUT_MS = 5_000;

const distTagSchema = z.object({ version: z.string() });

export interface FetchLatestVersionOptions {
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
  registryBaseUrl?: string | undefined;
}

export async function fetchLatestVersion(
  name: string,
  options: FetchLatestVersionOptions = {},
): Promise<string | null> {
  const {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    registryBaseUrl = REGISTRY_BASE_URL,
  } = options;
  const url = `${registryBaseUrl}/${name}/latest`;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const parsed = distTagSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.version : null;
  } catch {
    return null;
  }
}
