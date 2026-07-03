import { useStdout } from "ink";
import { useEffect, useState } from "react";

const FALLBACK_COLUMNS = 80;
const FALLBACK_ROWS = 30;

export interface TerminalSize {
  columns: number;
  rows: number;
}

export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const readSize = (): TerminalSize => ({
    columns: stdout.columns || FALLBACK_COLUMNS,
    rows: stdout.rows || FALLBACK_ROWS,
  });
  const [size, setSize] = useState(readSize);
  useEffect(() => {
    const onResize = (): void => {
      setSize({
        columns: stdout.columns || FALLBACK_COLUMNS,
        rows: stdout.rows || FALLBACK_ROWS,
      });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
}
