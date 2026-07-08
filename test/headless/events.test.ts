import { describe, expect, it } from "vitest";
import { compactFields } from "../../src/headless/events.js";

describe("compactFields", () => {
  it("drops undefined values", () => {
    expect(compactFields({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
  });

  it("keeps falsy but defined values", () => {
    expect(compactFields({ a: 0, b: false, c: "", d: null })).toEqual({
      a: 0,
      b: false,
      c: "",
      d: null,
    });
  });

  it("returns an empty object for empty input", () => {
    expect(compactFields({})).toEqual({});
  });
});
