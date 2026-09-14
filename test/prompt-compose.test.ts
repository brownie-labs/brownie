import { describe, expect, it } from "vitest";
import { composePrompt } from "../src/prompt-compose.js";

describe("composePrompt", () => {
  it("returns the prompt untouched when there is no context", () => {
    expect(composePrompt("prompt\n", "")).toBe("prompt\n");
    expect(composePrompt("prompt\n", "  \n\n")).toBe("prompt\n");
  });

  it("appends the context after a blank line and ends with a newline", () => {
    expect(composePrompt("prompt\n\n", "# Workspace context\n\n")).toBe(
      "prompt\n\n# Workspace context\n",
    );
  });

  it("keeps the context intact inside the block", () => {
    const context = "# Workspace context\n\n- `/workspace/api`\n\n## Machine\n\n- Docker";

    expect(composePrompt("identity", context)).toBe(`identity\n\n${context}\n`);
  });
});
