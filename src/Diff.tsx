import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { diffStat, parseUnifiedDiff, wordDiff } from "./diffModel";

function classify(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) return "hdr";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("diff --git") || line.startsWith("index ")) return "meta";
  return "ctx";
}

export function Diff(props: {
  text: string;
  loading: boolean;
  focusFile?: string | null;
  ownedFiles?: string[];
  ownedOnly?: boolean;
}) {
  const lines = createMemo(() => props.text.split("\n"));
  const fileForHeader = (line: string) => {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    return match?.[2] ?? null;
  };
  createEffect(() => {
    const file = props.focusFile;
    if (file)
      document
        .querySelector(`[data-review-file="${CSS.escape(file)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  const [mode, setMode] = createSignal<"unified" | "side">("unified");
  const [ignoreWhitespace, setIgnoreWhitespace] = createSignal(false);
  const files = createMemo(() =>
    parseUnifiedDiff(props.text).filter(
      (file) =>
        !props.ownedOnly || (props.ownedFiles ?? []).includes(file.path),
    ),
  );
  const visibleLines = createMemo(() => {
    if (!props.ownedOnly) return lines();
    const owned = new Set(props.ownedFiles ?? []);
    const result: string[] = [];
    let include = false;
    for (const line of lines()) {
      const file = fileForHeader(line);
      if (file) include = owned.has(file);
      if (include) result.push(line);
    }
    return result;
  });
  const stat = createMemo(() => diffStat(parseUnifiedDiff(props.text)));

  return (
    <div class="diff-view">
      <Show
        when={!props.loading}
        fallback={<p class="hint pad">Loading diff…</p>}
      >
        <Show
          when={props.text.trim().length}
          fallback={<p class="hint pad">No changes.</p>}
        >
          <div class="diff-toolbar">
            <span class="hint">
              {stat().files} files · +{stat().additions} −{stat().deletions}
            </span>
            <div class="diff-modes">
              <button
                type="button"
                class={mode() === "unified" ? "active" : ""}
                onClick={() => setMode("unified")}
              >
                Unified
              </button>
              <button
                type="button"
                class={mode() === "side" ? "active" : ""}
                onClick={() => setMode("side")}
              >
                Side by side
              </button>
            </div>
            <label class="diff-whitespace">
              <input
                type="checkbox"
                checked={ignoreWhitespace()}
                onChange={(e) => setIgnoreWhitespace(e.currentTarget.checked)}
              />{" "}
              Ignore whitespace
            </label>
          </div>
          <Show
            when={mode() === "side"}
            fallback={
              <pre class="diff-pre">
                <For each={visibleLines()}>
                  {(line) => (
                    <div
                      class={`diff-line ${classify(line)}`}
                      data-review-file={fileForHeader(line) ?? undefined}
                    >
                      {line || " "}
                    </div>
                  )}
                </For>
              </pre>
            }
          >
            <div class="diff-side">
              <For each={files()}>
                {(file) => (
                  <div
                    class="diff-side-file"
                    data-review-file={file.path || undefined}
                  >
                    <div class="diff-line hdr">{file.path || "(diff)"}</div>
                    <For each={file.hunks}>
                      {(hunk) => (
                        <div class="diff-side-hunk">
                          <div class="diff-line hunk">{hunk.header}</div>
                          <For each={hunk.rows}>
                            {(row) => (
                              <div class="diff-side-row">
                                <div
                                  class={`diff-side-cell ${
                                    row.left
                                      ? row.kind === "ctx"
                                        ? "ctx"
                                        : "del"
                                      : "empty"
                                  }`}
                                >
                                  <span class="diff-lno">
                                    {row.left?.n ?? ""}
                                  </span>
                                  <span class="diff-txt">
                                    <For
                                      each={
                                        row.kind === "chg" && row.left
                                          ? wordDiff(
                                              row.left.text,
                                              row.right?.text ?? "",
                                              ignoreWhitespace(),
                                            ).left
                                          : [
                                              {
                                                kind: "same" as const,
                                                text: row.left?.text ?? "",
                                              },
                                            ]
                                      }
                                    >
                                      {(segment) => (
                                        <span
                                          class={
                                            segment.kind === "del"
                                              ? "diff-word-del"
                                              : undefined
                                          }
                                        >
                                          {segment.text}
                                        </span>
                                      )}
                                    </For>
                                  </span>
                                </div>
                                <div
                                  class={`diff-side-cell ${
                                    row.right
                                      ? row.kind === "ctx"
                                        ? "ctx"
                                        : "add"
                                      : "empty"
                                  }`}
                                >
                                  <span class="diff-lno">
                                    {row.right?.n ?? ""}
                                  </span>
                                  <span class="diff-txt">
                                    <For
                                      each={
                                        row.kind === "chg" && row.right
                                          ? wordDiff(
                                              row.left?.text ?? "",
                                              row.right.text,
                                              ignoreWhitespace(),
                                            ).right
                                          : [
                                              {
                                                kind: "same" as const,
                                                text: row.right?.text ?? "",
                                              },
                                            ]
                                      }
                                    >
                                      {(segment) => (
                                        <span
                                          class={
                                            segment.kind === "add"
                                              ? "diff-word-add"
                                              : undefined
                                          }
                                        >
                                          {segment.text}
                                        </span>
                                      )}
                                    </For>
                                  </span>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
