/** Clamps a draft's newline count to the textarea row range. */
export function composerRows(text: string, minRows: number, maxRows: number): number {
  const lineCount = text.split("\n").length;
  return Math.min(maxRows, Math.max(minRows, lineCount));
}

export const COMPOSER_MIN_ROWS = 1;
export const COMPOSER_MAX_ROWS = 5;
