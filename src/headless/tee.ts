type AnyCall = (...args: unknown[]) => void;

export function teeReporter<R extends object>(primary: R, secondary: Partial<R>): R {
  const tee: Record<string, unknown> = {};
  const extra = secondary as Record<string, unknown>;
  for (const key of Object.keys(primary)) {
    const first = (primary as Record<string, unknown>)[key];
    const second = extra[key];
    tee[key] =
      typeof first === "function" && typeof second === "function"
        ? (...args: unknown[]): void => {
            (first as AnyCall)(...args);
            (second as AnyCall)(...args);
          }
        : first;
  }
  return tee as R;
}
