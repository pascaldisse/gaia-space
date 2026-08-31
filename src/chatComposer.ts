/** Clamps a draft's newline count to the textarea row range. */
export function composerRows(text: string, minRows: number, maxRows: number): number {
  const lineCount = text.split("\n").length;
  return Math.min(maxRows, Math.max(minRows, lineCount));
}

export const COMPOSER_MIN_ROWS = 1;
export const COMPOSER_MAX_ROWS = 5;

/** Includes visual wraps measured by a textarea's scrollHeight. The caller supplies
 * line height so this stays pure and testable outside the DOM. */
export function composerRowsForHeight(
  text: string, minRows: number, maxRows: number, scrollHeight: number, lineHeight: number,
): number {
  const visualRows = lineHeight > 0 ? Math.ceil(scrollHeight / lineHeight) : 0;
  return Math.min(maxRows, Math.max(composerRows(text, minRows, maxRows), visualRows));
}
