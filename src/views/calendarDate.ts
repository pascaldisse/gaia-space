/** Date-only convention: YYYY-MM-DD travels as a calendar date, never an instant. */
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const dateOnlyLocal = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid date-only value");
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};
