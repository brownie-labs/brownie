import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demoDir = resolve(dirname(fileURLToPath(import.meta.url)), "acme-shop");
const brownieDir = join(demoDir, ".brownie");
const promptsDir = join(brownieDir, "prompts");

rmSync(join(brownieDir, "data"), { recursive: true, force: true });
rmSync(join(brownieDir, "logs"), { recursive: true, force: true });
mkdirSync(promptsDir, { recursive: true });

const settings = {
  monitor: { model: "sonnet", intervalMinutes: 5 },
  executor: { model: "opus", effort: "high" },
  summarizer: { model: "haiku" },
};

writeFileSync(
  join(brownieDir, "settings.json"),
  `${JSON.stringify(settings, null, 2)}\n`,
);
writeFileSync(join(brownieDir, ".gitignore"), "data/\nlogs/\n");
writeFileSync(
  join(promptsDir, "monitor.prompt.md"),
  "# Monitor: acme-shop\n\nCheck CI on main and open bug issues; report actionable tasks.\n",
);
writeFileSync(
  join(promptsDir, "executor.prompt.md"),
  "# Executor: acme-shop\n\nWork on a branch, run pnpm check before committing, open a PR.\n",
);

console.log(`Demo project ready: ${demoDir}`);
