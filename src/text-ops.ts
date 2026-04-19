export function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

export function offsetToLineAndColumn(
  lineStarts: number[],
  startOffset: number,
  endOffset: number
): { line: number; columnStart: number; columnEnd: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid] ?? 0;
    const nextLineStart = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (startOffset < lineStart) {
      high = mid - 1;
    } else if (startOffset >= nextLineStart) {
      low = mid + 1;
    } else {
      return {
        line: mid + 1,
        columnStart: startOffset - lineStart + 1,
        columnEnd: endOffset - lineStart + 1
      };
    }
  }

  const lastStart = lineStarts[lineStarts.length - 1] ?? 0;
  return {
    line: lineStarts.length,
    columnStart: startOffset - lastStart + 1,
    columnEnd: endOffset - lastStart + 1
  };
}
