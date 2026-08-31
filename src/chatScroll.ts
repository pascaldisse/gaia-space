// Pure scroll-position decisions for live chat panes. DOM reads and writes stay in Chat.
export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export type ScrollAnchor = Pick<ScrollMetrics, "scrollTop" | "scrollHeight">;

export type AutoScrollState = {
  opening: boolean;
  wasNearBottom: boolean;
};

export function isNearBottom(metrics: ScrollMetrics, threshold = 24): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold;
}

// Opening a conversation always reveals its newest message. Later updates only follow
// when the reader was already at the live edge.
export function shouldAutoScroll(state: AutoScrollState): boolean {
  return state.opening || state.wasNearBottom;
}

/** Offer a manual return only after the reader leaves the live edge. */
export function shouldShowJumpButton(metrics: ScrollMetrics, threshold = 24): boolean {
  return !isNearBottom(metrics, threshold);
}

// Browsers clamp this to the maximum scrollTop; using scrollHeight also remains correct
// if the client height changes between measuring and assigning.
export function scrollTargetFor(metrics: ScrollMetrics): number {
  return metrics.scrollHeight;
}

export function captureScroll(metrics: ScrollMetrics): ScrollAnchor {
  return { scrollTop: metrics.scrollTop, scrollHeight: metrics.scrollHeight };
}

// Older history is prepended. Preserve the row under the reader's eye instead of
// treating that deliberate history position as a request to follow the live edge.
export function restorePrependedScroll(anchor: ScrollAnchor, after: ScrollMetrics): number {
  return anchor.scrollTop + after.scrollHeight - anchor.scrollHeight;
}
