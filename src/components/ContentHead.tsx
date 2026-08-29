import { Show, type JSX } from "solid-js";
import { Icon, type IconName } from "./Icon";
import "./ContentHead.css";

/** ── WHAT YOU ARE LOOKING AT, ABOVE THE THINGS THEMSELVES ───────────────────
 *
 *  Knowledge introduced it and it earned its place: between the page's action row
 *  and the first card stands a mark, a name and ONE sentence — "My Documents ·
 *  Open a document, or drag it onto a shelf to file it." The page header says what
 *  the AREA is; this says what the CURRENT CONTENT is, which is a different fact
 *  the moment a surface can show more than one thing (a library, a filter, a
 *  section of Development).
 *
 *  It is a statement, never a control: no buttons live here. Acts belong in the
 *  action row above (see PageHeader.css), and the one sentence must say what can be
 *  done with what follows — not repeat the title in other words.
 */
export default function ContentHead(props: {
  icon: IconName;
  title: string;
  /** One line. If there is nothing true to say, pass nothing. */
  line?: JSX.Element;
  class?: string;
}): JSX.Element {
  return (
    <div class="content-head" classList={props.class ? { [props.class]: true } : undefined}>
      <span class="content-head-icon" aria-hidden="true"><Icon name={props.icon} size={24} /></span>
      <div class="content-head-text">
        <h2>{props.title}</h2>
        <Show when={props.line}>{(line) => <p>{line()}</p>}</Show>
      </div>
    </div>
  );
}
