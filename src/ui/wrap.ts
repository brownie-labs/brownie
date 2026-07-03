export function wrapText(text: string, firstWidth: number, restWidth: number): string[] {
  const rows: string[] = [];
  let line = "";
  let width = Math.max(1, firstWidth);
  const flush = (): void => {
    rows.push(line);
    line = "";
    width = Math.max(1, restWidth);
  };
  for (const word of text.split(" ")) {
    let token = word;
    while (token.length > 0) {
      const separator = line.length > 0 ? 1 : 0;
      const space = width - line.length - separator;
      if (token.length <= space) {
        line = line.length > 0 ? `${line} ${token}` : token;
        token = "";
      } else if (line.length === 0) {
        line = token.slice(0, width);
        token = token.slice(width);
        flush();
      } else {
        flush();
      }
    }
  }
  if (line.length > 0 || rows.length === 0) rows.push(line);
  return rows;
}

export function capRows(rows: string[], maxRows: number, width: number): string[] {
  if (rows.length <= maxRows) return rows;
  const kept = rows.slice(0, Math.max(1, maxRows));
  const lastIndex = kept.length - 1;
  const last = kept[lastIndex] ?? "";
  kept[lastIndex] =
    last.length + 2 > width ? `${last.slice(0, Math.max(0, width - 2))} …` : `${last} …`;
  return kept;
}
