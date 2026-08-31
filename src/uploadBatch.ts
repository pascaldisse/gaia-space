export type UploadBatchResult<T> = {
  successes: T[];
  failures: { item: T; error: unknown }[];
};

/** Run every requested upload: one refusal must not prevent later files from landing. */
export async function settleUploadBatch<T>(
  items: readonly T[],
  upload: (item: T) => Promise<void>,
): Promise<UploadBatchResult<T>> {
  const settled = await Promise.all(items.map(async (item) => {
    try {
      await upload(item);
      return { item, ok: true as const };
    } catch (error) {
      return { item, ok: false as const, error };
    }
  }));
  return {
    successes: settled.filter((result) => result.ok).map((result) => result.item),
    failures: settled
      .filter((result): result is { item: T; ok: false; error: unknown } => !result.ok)
      .map(({ item, error }) => ({ item, error })),
  };
}
