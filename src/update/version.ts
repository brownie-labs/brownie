export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const SEMVER_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(raw: string): SemVer | null {
  const match = SEMVER_PATTERN.exec(raw.trim());
  if (match === null) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ?? null,
  };
}

function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const aParts = a.split(".");
  const bParts = b.split(".");
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const aPart = aParts[i];
    const bPart = bParts[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    const aNum = Number(aPart);
    const bNum = Number(bPart);
    const aIsNum = Number.isInteger(aNum);
    const bIsNum = Number.isInteger(bNum);
    if (aIsNum && bIsNum) {
      if (aNum !== bNum) return aNum < bNum ? -1 : 1;
    } else if (aIsNum !== bIsNum) {
      return aIsNum ? -1 : 1;
    } else if (aPart !== bPart) {
      return aPart < bPart ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(a: SemVer, b: SemVer): -1 | 0 | 1 {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease) as -1 | 0 | 1;
}

export function isNewer(current: string, latest: string): boolean {
  const currentVersion = parseVersion(current);
  const latestVersion = parseVersion(latest);
  if (currentVersion === null || latestVersion === null) return false;
  return compareVersions(currentVersion, latestVersion) < 0;
}
