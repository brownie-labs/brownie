import { describe, expect, it } from "vitest";
import { capRows, wrapText } from "../../src/ui/wrap.js";

describe("wrapText", () => {
  it("returns a single row when the text fits", () => {
    expect(wrapText("hello world", 20, 20)).toEqual(["hello world"]);
  });

  it("wraps on word boundaries", () => {
    expect(wrapText("one two three four", 9, 9)).toEqual(["one two", "three", "four"]);
  });

  it("uses the narrower width for continuation rows", () => {
    expect(wrapText("aaa bbb ccc", 11, 3)).toEqual(["aaa bbb ccc"]);
    expect(wrapText("aaa bbb ccc ddd", 11, 3)).toEqual(["aaa bbb ccc", "ddd"]);
    expect(wrapText("aaaa bbb ccc", 4, 7)).toEqual(["aaaa", "bbb ccc"]);
  });

  it("hard-breaks tokens longer than the row width", () => {
    expect(wrapText("abcdefghij", 4, 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("xy abcdefgh", 5, 5)).toEqual(["xy", "abcde", "fgh"]);
  });

  it("returns one empty row for empty text", () => {
    expect(wrapText("", 10, 10)).toEqual([""]);
  });

  it("never loops on non-positive widths", () => {
    expect(wrapText("abc", 0, 0)).toEqual(["a", "b", "c"]);
  });
});

describe("capRows", () => {
  it("returns the rows unchanged when under the limit", () => {
    expect(capRows(["a", "b"], 3, 10)).toEqual(["a", "b"]);
  });

  it("cuts to the limit and marks the last row with an ellipsis", () => {
    expect(capRows(["aaa", "bbb", "ccc", "ddd"], 2, 10)).toEqual(["aaa", "bbb …"]);
  });

  it("trims the last row when the ellipsis would overflow the width", () => {
    expect(capRows(["aaaa", "bbbb", "cccc"], 2, 4)).toEqual(["aaaa", "bb …"]);
  });
});
