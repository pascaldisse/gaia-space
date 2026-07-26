import { For, Show, createMemo } from "solid-js";

function classify(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) return "hdr";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("diff --git") || line.startsWith("index ")) return "meta";
  return "ctx";
}

export function Diff(props: { text: string; loading: boolean }) {
  const lines = createMemo(() => props.text.split("\n"));

  return (
    <div class="diff-view">
      <Show when={!props.loading} fallback={<p class="hint pad">Loading diff…</p>}>
        <Show
          when={props.text.trim().length}
          fallback={<p class="hint pad">No changes.</p>}
        >
          <pre class="diff-pre">
            <For each={lines()}>
              {(line) => <div class={`diff-line ${classify(line)}`}>{line || " "}</div>}
            </For>
          </pre>
        </Show>
      </Show>
    </div>
  );
}
