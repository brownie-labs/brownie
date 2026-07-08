import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { PromptEditor, type PromptEditorProps } from "../../src/ui/prompt-editor.js";
import { eventually } from "../helpers.js";

const ARROW_UP = "\u001B[A";
const ARROW_DOWN = "\u001B[B";
const ARROW_RIGHT = "\u001B[C";
const ARROW_LEFT = "\u001B[D";
const HOME = "\u001B[H";
const END = "\u001B[F";
const ESCAPE = "\u001B";
const BACKSPACE = "\u007F";
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const ENTER = "\r";
const TAB = "\t";

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function editor(overrides: Partial<PromptEditorProps> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const rendered = render(
    <PromptEditor
      title="What should the monitor watch?"
      step="1/2"
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  const type = async (data: string) => {
    rendered.stdin.write(data);
    await tick();
  };
  return { ...rendered, onSubmit, onCancel, type };
}

describe("PromptEditor", () => {
  it("shows the title, step, placeholder and hint", () => {
    const { lastFrame, unmount } = editor({ placeholder: "e.g. GitHub issues" });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("What should the monitor watch?");
    expect(frame).toContain("step 1/2");
    expect(frame).toContain("e.g. GitHub issues");
    expect(frame).toContain("Enter: new line · Ctrl+D: submit · Esc: cancel");
    unmount();
  });

  it("types text and hides the placeholder", async () => {
    const { lastFrame, type, unmount } = editor({ placeholder: "gone" });
    await type("watch issues");
    await eventually(() => {
      expect(lastFrame()).toContain("watch issues");
    });
    expect(lastFrame()).not.toContain("gone");
    unmount();
  });

  it("wraps long lines instead of truncating them", async () => {
    const { lastFrame, onSubmit, type, unmount } = editor();
    const long = `${"a".repeat(120)}END`;
    await type(long);
    await eventually(() => {
      expect(lastFrame()).toContain("END");
    });
    expect(lastFrame()).not.toContain("…");
    await type(CTRL_D);
    await eventually(() => {
      expect(onSubmit).toHaveBeenCalledWith(long);
    });
    unmount();
  });

  it("Enter inserts a new line instead of submitting", async () => {
    const { lastFrame, onSubmit, type, unmount } = editor();
    await type("first");
    await type(ENTER);
    await type("second");
    expect(onSubmit).not.toHaveBeenCalled();
    await eventually(() => {
      expect(lastFrame()).toContain("second");
    });
    expect(lastFrame()).toContain("first");
    unmount();
  });

  it("a pasted chunk with \\r and \\r\\n becomes multiple lines", async () => {
    const { lastFrame, onSubmit, type, unmount } = editor();
    await type("# Role\rBe diligent\r\n- rule one");
    await eventually(() => {
      expect(lastFrame()).toContain("- rule one");
    });
    expect(lastFrame()).toContain("# Role");
    expect(lastFrame()).toContain("Be diligent");
    await type(CTRL_D);
    await eventually(() => {
      expect(onSubmit).toHaveBeenCalledWith("# Role\nBe diligent\n- rule one");
    });
    unmount();
  });

  it("filters stray bracketed paste markers", async () => {
    const { lastFrame, type, unmount } = editor();
    await type("[200~");
    await type("safe");
    await type("[201~");
    await eventually(() => {
      expect(lastFrame()).toContain("safe");
    });
    expect(lastFrame()).not.toContain("[200~");
    expect(lastFrame()).not.toContain("[201~");
    unmount();
  });

  it("backspace joins lines at the start of a line", async () => {
    const { lastFrame, onSubmit, type, unmount } = editor();
    await type("ab");
    await type(ENTER);
    await type("cd");
    await type(HOME);
    await type(BACKSPACE);
    await type(END);
    await eventually(() => {
      expect(lastFrame()).toContain("abcd");
    });
    await type(CTRL_D);
    await eventually(() => {
      expect(onSubmit).toHaveBeenCalledWith("abcd");
    });
    unmount();
  });

  it("moves across line boundaries with arrows and edits mid-text", async () => {
    const { onSubmit, type, unmount } = editor();
    await type("one");
    await type(ENTER);
    await type("two");
    await type(ARROW_UP);
    await type(END);
    await type(ARROW_RIGHT);
    await type("X");
    await type(ARROW_LEFT);
    await type(ARROW_LEFT);
    await type("Y");
    await type(ARROW_DOWN);
    await type(CTRL_D);
    await eventually(() => {
      expect(onSubmit).toHaveBeenCalledWith("oneY\nXtwo");
    });
    unmount();
  });

  it("tab inserts two spaces", async () => {
    const { onSubmit, type, unmount } = editor();
    await type("a");
    await type(TAB);
    await type("b");
    await type(CTRL_D);
    await eventually(() => {
      expect(onSubmit).toHaveBeenCalledWith("a  b");
    });
    unmount();
  });

  it("keeps the cursor visible in a limited viewport", async () => {
    const { lastFrame, type, unmount } = editor({ maxVisibleLines: 3 });
    await type("l1\rl2\rl3\rl4\rl5");
    await eventually(() => {
      expect(lastFrame()).toContain("… 2 more lines above");
    });
    await type(ARROW_UP);
    await type(ARROW_UP);
    await type(ARROW_UP);
    await type(ARROW_UP);
    await eventually(() => {
      expect(lastFrame()).toContain("… 2 more lines below");
    });
    unmount();
  });

  it("starts from the initial value with the cursor at the end", async () => {
    const { lastFrame, onSubmit, type, unmount } = editor({
      initialValue: "existing\ncontent",
    });
    expect(lastFrame()).toContain("existing");
    await type("!");
    await type(CTRL_D);
    await eventually(() => {
      expect(onSubmit).toHaveBeenCalledWith("existing\ncontent!");
    });
    unmount();
  });

  it("refuses to submit empty content and shows a warning", async () => {
    const { lastFrame, onSubmit, type, unmount } = editor();
    await type(CTRL_D);
    expect(onSubmit).not.toHaveBeenCalled();
    await eventually(() => {
      expect(lastFrame()).toContain("enter at least one line");
    });
    await type("now filled");
    await eventually(() => {
      expect(lastFrame()).toContain("Enter: new line");
    });
    unmount();
  });

  it("trims trailing whitespace on submit", async () => {
    const { onSubmit, type, unmount } = editor();
    await type("text");
    await type(ENTER);
    await type(ENTER);
    await type(CTRL_D);
    await eventually(() => {
      expect(onSubmit).toHaveBeenCalledWith("text");
    });
    unmount();
  });

  it("cancels on Esc and on Ctrl+C", async () => {
    const first = editor();
    await first.type(ESCAPE);
    await eventually(() => {
      expect(first.onCancel).toHaveBeenCalledTimes(1);
    });
    first.unmount();

    const second = editor();
    await second.type(CTRL_C);
    await eventually(() => {
      expect(second.onCancel).toHaveBeenCalledTimes(1);
    });
    second.unmount();
  });
});
