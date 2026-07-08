import { describe, expect, it, vi } from "vitest";
import { teeReporter } from "../../src/headless/tee.js";

interface SampleReporter {
  started(value: number): void;
  finished(label: string, ok: boolean): void;
  session: (event: string) => void;
  name: string;
}

describe("teeReporter", () => {
  it("calls both implementations of every shared method with the same args", () => {
    const primary = {
      started: vi.fn(),
      finished: vi.fn(),
      session: vi.fn(),
      name: "primary",
    };
    const secondary = {
      started: vi.fn(),
      finished: vi.fn(),
      session: vi.fn(),
      name: "secondary",
    };

    const tee = teeReporter<SampleReporter>(primary, secondary);
    tee.started(7);
    tee.finished("task", true);
    tee.session("init");

    expect(primary.started).toHaveBeenCalledWith(7);
    expect(secondary.started).toHaveBeenCalledWith(7);
    expect(primary.finished).toHaveBeenCalledWith("task", true);
    expect(secondary.finished).toHaveBeenCalledWith("task", true);
    expect(primary.session).toHaveBeenCalledWith("init");
    expect(secondary.session).toHaveBeenCalledWith("init");
  });

  it("keeps primary-only methods when the secondary does not implement them", () => {
    const primary = { started: vi.fn(), finished: vi.fn(), session: vi.fn() };
    const secondary = { finished: vi.fn() };

    const tee = teeReporter(primary, secondary);
    tee.started(1);
    tee.finished();

    expect(primary.started).toHaveBeenCalledWith(1);
    expect(primary.finished).toHaveBeenCalledTimes(1);
    expect(secondary.finished).toHaveBeenCalledTimes(1);
  });

  it("copies non-function properties from the primary", () => {
    const primary = { name: "primary", started: vi.fn() };
    const secondary = { name: "secondary", started: vi.fn() };

    const tee = teeReporter(primary, secondary);

    expect(tee.name).toBe("primary");
  });

  it("preserves call order: primary first, then secondary", () => {
    const order: string[] = [];
    const primary = {
      started: () => {
        order.push("primary");
      },
    };
    const secondary = {
      started: () => {
        order.push("secondary");
      },
    };

    teeReporter(primary, secondary).started();

    expect(order).toEqual(["primary", "secondary"]);
  });
});
