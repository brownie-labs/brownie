import { describe, expect, it } from "vitest";
import { compareVersions, isNewer, parseVersion } from "../../src/update/version.js";

describe("parseVersion", () => {
  it("parses plain and v-prefixed versions", () => {
    expect(parseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
    });
    expect(parseVersion("v0.2.0")).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      prerelease: null,
    });
  });

  it("parses prerelease and ignores build metadata", () => {
    expect(parseVersion("1.2.3-beta.1")?.prerelease).toBe("beta.1");
    expect(parseVersion("1.2.3+build.5")?.prerelease).toBe(null);
  });

  it("returns null for garbage", () => {
    expect(parseVersion("nope")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("compareVersions", () => {
  const of = (raw: string) => {
    const v = parseVersion(raw);
    if (v === null) throw new Error(`bad version ${raw}`);
    return v;
  };

  it("orders by major, minor, patch", () => {
    expect(compareVersions(of("1.0.0"), of("1.0.0"))).toBe(0);
    expect(compareVersions(of("1.0.0"), of("2.0.0"))).toBe(-1);
    expect(compareVersions(of("1.3.0"), of("1.2.9"))).toBe(1);
    expect(compareVersions(of("1.2.3"), of("1.2.4"))).toBe(-1);
  });

  it("treats a prerelease as lower than its release", () => {
    expect(compareVersions(of("1.0.0-rc.1"), of("1.0.0"))).toBe(-1);
    expect(compareVersions(of("1.0.0"), of("1.0.0-rc.1"))).toBe(1);
    expect(compareVersions(of("1.0.0-alpha"), of("1.0.0-beta"))).toBe(-1);
    expect(compareVersions(of("1.0.0-1"), of("1.0.0-2"))).toBe(-1);
  });
});

describe("isNewer", () => {
  it("detects a newer latest", () => {
    expect(isNewer("0.2.0", "0.3.0")).toBe(true);
    expect(isNewer("0.2.0", "0.2.1")).toBe(true);
  });

  it("is false when equal or older", () => {
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.3.0", "0.2.0")).toBe(false);
  });

  it("is false when either version is unparseable", () => {
    expect(isNewer("unknown", "0.3.0")).toBe(false);
    expect(isNewer("0.2.0", "garbage")).toBe(false);
  });
});
