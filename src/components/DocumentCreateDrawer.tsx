import { Show, type JSX } from "solid-js";
import type { DocumentBodyFormat } from "../api/documents";
import { PillMenu } from "./controls";
import "./DocumentCreateDrawer.css";

/** ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 *  Inside a channel's "Files & Links" tab the scope is already decided — you
 *  are in the channel, the channel belongs to the project, that IS the project.
 *  So the surface there offers two actions and nothing else, and the few facts
 *  a new item actually needs are asked here, once, when you ask for them.
 *
 *  Uploading is deliberately NOT routed through this drawer: the file picker is
 *  already a dialog that collects exactly one thing. Wrapping a picker in a
 *  drawer would add a step to the one act the product owner asked to be
 *  immediate. What is left needs a form — a title, and for a document a type.
 */

export type DocumentCreateMode = "document" | "folder";

export type DocumentCreateDrawerProps = {
  mode: DocumentCreateMode;
  /** Where the new item lands, stated as a fact — never as a control. */
  scopeLabel: string;
  name: string;
  setName: (value: string) => void;
  bodyFormat: DocumentBodyFormat;
  setBodyFormat: (value: DocumentBodyFormat) => void;
  busy?: boolean;
  onSubmit: () => void;
  onClose: () => void;
};

export default function DocumentCreateDrawer(props: DocumentCreateDrawerProps): JSX.Element {
  const isDoc = () => props.mode === "document";
  const title = () => (isDoc() ? "New document" : "New folder");

  return (
    <div class="dcd-root" role="dialog" aria-modal="true" aria-label={title()}>
      <div class="dcd-backdrop" onClick={() => props.onClose()} />
      <div class="dcd-panel">
        <div class="dcd-head">
          <div>
            <h2>{title()}</h2>
            {/* The destination is shown because it is reassuring, and is NOT a
                picker because it is not a question: the channel already answered it. */}
            <p>Lands in <strong>{props.scopeLabel}</strong>.</p>
          </div>
          <button type="button" class="dcd-close" aria-label="Close" onClick={() => props.onClose()}>×</button>
        </div>

        <form
          class="dcd-form"
          onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}
        >
          <label class="dcd-field">
            <span>{isDoc() ? "Title" : "Folder name"}</span>
            <input
              class="dcd-input"
              aria-label={isDoc() ? "New document title" : "New folder name"}
              required
              autofocus
              placeholder={isDoc() ? "Release notes" : "Specs"}
              value={props.name}
              onInput={(event) => props.setName(event.currentTarget.value)}
            />
          </label>

          <Show when={isDoc()}>
            <div class="dcd-field">
              <span>Type</span>
              <PillMenu
                label="Document body type"
                value={props.bodyFormat}
                onChange={(value) => props.setBodyFormat(value as DocumentBodyFormat)}
                options={[
                  { value: "text", label: "Text / Markdown" },
                  { value: "rich-text", label: "Rich text" },
                  { value: "checklist", label: "Checklist" },
                  { value: "code", label: "Code" },
                ]}
              />
            </div>
          </Show>

          <div class="dcd-actions">
            <button type="button" class="dcd-btn" onClick={() => props.onClose()}>Cancel</button>
            <button type="submit" class="dcd-btn dcd-primary" disabled={props.busy || !props.name.trim()}>
              {isDoc() ? "Create document" : "Create folder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
