import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demoDir = resolve(dirname(fileURLToPath(import.meta.url)), "acme-shop");
const brownieDir = join(demoDir, ".brownie");

rmSync(join(brownieDir, "data"), { recursive: true, force: true });
rmSync(join(brownieDir, "logs"), { recursive: true, force: true });
rmSync(join(brownieDir, "prompts"), { recursive: true, force: true });
mkdirSync(brownieDir, { recursive: true });

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

console.log(`Demo project ready: ${demoDir}`);
