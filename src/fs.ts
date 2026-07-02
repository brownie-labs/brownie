import { access, constants } from "node:fs/promises";

export function canAccess(path: string, mode: number): Promise<boolean> {
  return access(path, mode).then(
    () => true,
    () => false,
  );
}

export async function assertReadable(path: string, label: string): Promise<void> {
  if (!(await canAccess(path, constants.R_OK))) {
    throw new Error(`Cannot read ${label}: ${path}`);
  }
}
