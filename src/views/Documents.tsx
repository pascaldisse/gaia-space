import { createResource, createSignal, createEffect, For, Show } from "solid-js";
import { marked } from "marked";
import "../App.css";
import "./Documents.css";
import { Resizer, paneWidth } from "../components/Resizer";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { profileId } from "../session";
import { useDeepLink, linkContainer, linkEntity, linkProps, route } from "../router";
import {
  documentsApi,
  newId,
  type ContainerType,
  type Document,
  type DocumentFolder,
} from "../api/documents";

const CONTAINER_TABS: { key: ContainerType; label: string }[] = [
  { key: "my-docs", label: "My Documents" },
  { key: "project", label: "Project Docs" },
  { key: "kb", label: "Knowledge Base" },
];

function when(ts: number | null) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Documents() {
  const [error, setError] = createSignal<string | null>(null);
  const [treeW, setTreeW] = paneWidth("documents.tree.width", 260);
  const fail = (e: unknown) => setError(String(e));

  // Document ownership follows the locked web session; it is never selectable here.
  const actingProfileId = () => profileId() || null;
  const [profiles] = createResource(() => documentsApi.listProfiles());

  const [projects] = createResource(() => documentsApi.listProjects());
  const [selectedProjectId, setSelectedProjectId] = createSignal<string | null>(null);
  createEffect(() => {
    const list = projects();
    if (list && list.length && !selectedProjectId()) setSelectedProjectId(list[0].id);
  });

  const [activeContainer, setActiveContainer] = createSignal<ContainerType>("my-docs");
  const [selectedBookId, setSelectedBookId] = createSignal<string | null>(null);
  const [newBookName, setNewBookName] = createSignal("");

  const containerId = () => {
    if (activeContainer() === "my-docs") return actingProfileId();
    if (activeContainer() === "project") return selectedProjectId();
    return selectedBookId();
  };
  // root-level folders sit directly under the container, except in KB where the book
  // itself is a container_id-self-referencing folder row and everything else nests
  // under its own id.
  const rootParentId = () => (activeContainer() === "kb" ? selectedBookId() : null);

  const [allFolders, { refetch: refetchFolders }] = createResource(() => documentsApi.listDocumentFolders());
  const [allDocuments, { refetch: refetchDocuments }] = createResource(() => documentsApi.listDocuments());

  const books = () => (allFolders() ?? []).filter((f) => f.container_type === "kb" && f.parent_id === null);
  createEffect(() => {
    if (activeContainer() === "kb" && !selectedBookId() && books().length) setSelectedBookId(books()[0].id);
  });

  const [showArchived, setShowArchived] = createSignal(false);

  const scopedFolders = () =>
    (allFolders() ?? []).filter(
      (f) =>
        f.container_type === activeContainer() &&
        f.container_id === containerId() &&
        f.id !== containerId() && // exclude the KB book's own self-row from the tree
        (showArchived() || !f.archived),
    );
  const scopedDocuments = () =>
    (allDocuments() ?? []).filter(
      (d) =>
        d.container_type === activeContainer() &&
        d.container_id === containerId() &&
        (showArchived() || !d.archived),
    );

  const [selectedFolderId, setSelectedFolderId] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  function toggleExpand(id: string) {
    const next = new Set(expanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  // ---- folder CRUD ----
  const [newFolderName, setNewFolderName] = createSignal("");
  async function createFolder() {
    const name = newFolderName().trim();
    const cid = containerId();
    if (!name || !cid) return;
    const folder: DocumentFolder = {
      id: newId("folder"),
      container_type: activeContainer(),
      container_id: cid,
      parent_id: selectedFolderId() ?? rootParentId(),
      name,
      description: null,
      archived: false,
    };
    try {
      await documentsApi.createDocumentFolder(folder);
      setNewFolderName("");
      await refetchFolders();
    } catch (e) {
      fail(e);
    }
  }
  async function createBook() {
    const name = newBookName().trim();
    if (!name) return;
    const id = newId("book");
    const folder: DocumentFolder = {
      id,
      container_type: "kb",
      container_id: id, // book is self-referencing: container_id == its own folder id
      parent_id: null,
      name,
      description: null,
      archived: false,
    };
    try {
      await documentsApi.createDocumentFolder(folder);
      setNewBookName("");
      await refetchFolders();
      setSelectedBookId(id);
    } catch (e) {
      fail(e);
    }
  }
  const [renamingFolderId, setRenamingFolderId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  function startRenameFolder(f: DocumentFolder) {
    setRenamingFolderId(f.id);
    setRenameValue(f.name);
  }
  async function saveRenameFolder(f: DocumentFolder) {
    const name = renameValue().trim();
    if (!name) return;
    try {
      await documentsApi.updateDocumentFolder({ ...f, name });
      setRenamingFolderId(null);
      await refetchFolders();
    } catch (e) {
      fail(e);
    }
  }
  async function toggleFolderArchived(f: DocumentFolder) {
    try {
      await documentsApi.updateDocumentFolder({ ...f, archived: !f.archived });
      await refetchFolders();
    } catch (e) {
      fail(e);
    }
  }
  async function moveFolderTo(f: DocumentFolder, newParentId: string) {
    const parentId = newParentId === "" ? rootParentId() : newParentId;
    if (parentId === f.id) return; // no-op: can't be its own parent
    try {
      await documentsApi.moveDocumentFolder(f.id, parentId);
      await refetchFolders();
    } catch (e) {
      fail(e);
    }
  }

  // ---- document CRUD ----
  const [newDocTitle, setNewDocTitle] = createSignal("");
  const [selectedDocumentId, setSelectedDocumentId] = createSignal<string | null>(null);
  async function createDocument() {
    const title = newDocTitle().trim();
    const cid = containerId();
    if (!title || !cid) return;
    const id = newId("doc");
    const document: Document = {
      id,
      container_type: activeContainer(),
      container_id: cid,
      folder_id: selectedFolderId(),
      doc_type: "text",
      title,
      body: "",
      version: 1,
      archived: false,
      created_by: actingProfileId(),
    };
    try {
      await documentsApi.createDocument(document);
      setNewDocTitle("");
      await refetchDocuments();
      setSelectedDocumentId(id);
    } catch (e) {
      fail(e);
    }
  }

  const selectedDocument = () => scopedDocuments().find((d) => d.id === selectedDocumentId()) ?? null;
  // A document URL carries its container, so a cold direct link restores the same tree the
  // in-app click would have opened (tab + project/book selection), not just the id.
  const docRoute = (id:string, container:ContainerType = activeContainer(), cid:string|null = containerId()) =>
    ({ view:"Documents", entityType:"document", entityId:id, containerType:container, containerId:cid ?? undefined });
  const containerRoute = (container:ContainerType) => ({
    view: "Documents", containerType: container,
    containerId: (container === "my-docs" ? actingProfileId() : container === "project" ? selectedProjectId() : selectedBookId()) ?? undefined,
  });
  const applyContainer = (container:string, cid?:string) => {
    if (container !== activeContainer()) setActiveContainer(container as ContainerType);
    if (!cid) return;
    if (container === "project") setSelectedProjectId(cid);
    else if (container === "kb") setSelectedBookId(cid);
    // My Documents is always scoped to the authenticated profile; ignore stale profile route IDs.
  };
  // route -> container switch (direct link / back / forward)
  createEffect(() => {
    const r = route();
    if (r.view !== "Documents" || !r.containerType) return;
    applyContainer(r.containerType, r.containerId);
  });
  useDeepLink("document", (id) => {
    setSelectedDocumentId(id);
    if (route().containerType) return;
    // container-less link (e.g. Goto hit): resolve the document's own container and
    // rewrite the URL so address bar and UI agree.
    const doc = allDocuments()?.find((d) => d.id === id);
    if (!doc) return;
    applyContainer(doc.container_type, doc.container_id ?? undefined);
    linkEntity("document", id, { containerType: doc.container_type, containerId: doc.container_id ?? undefined });
  }, () => setSelectedDocumentId(null));

  const [editTitle, setEditTitle] = createSignal("");
  const [editBody, setEditBody] = createSignal("");
  const [showPreview, setShowPreview] = createSignal(true);
  // sync editor fields when the *selected document id* changes — not on every refetch,
  // so in-progress edits survive background polling/refetches.
  createEffect((prevId: string | null | undefined) => {
    const doc = selectedDocument();
    const id = doc?.id ?? null;
    if (id !== prevId) {
      setEditTitle(doc?.title ?? "");
      setEditBody(doc?.body ?? "");
    }
    return id;
  }, null);

  const [versions, { refetch: refetchVersions }] = createResource(selectedDocumentId, (id) =>
    id ? documentsApi.listDocVersions(id) : Promise.resolve([]),
  );

  async function saveDocument() {
    const doc = selectedDocument();
    if (!doc) return;
    try {
      const saved = await documentsApi.saveDocument(doc.id, editTitle().trim() || doc.title, editBody(), actingProfileId());
      setEditTitle(saved.title);
      setEditBody(saved.body ?? "");
      await refetchDocuments();
      await refetchVersions();
    } catch (e) {
      fail(e);
    }
  }
  async function toggleArchiveDocument() {
    const doc = selectedDocument();
    if (!doc) return;
    try {
      await documentsApi.archiveDocument(doc.id, !doc.archived);
      await refetchDocuments();
    } catch (e) {
      fail(e);
    }
  }
  async function moveDocumentTo(folderId: string) {
    const doc = selectedDocument();
    const cid = containerId();
    if (!doc || !cid) return;
    try {
      await documentsApi.moveDocument(doc.id, doc.container_type, cid, folderId === "" ? null : folderId);
      await refetchDocuments();
    } catch (e) {
      fail(e);
    }
  }
  async function restoreVersion(version: number) {
    const doc = selectedDocument();
    if (!doc) return;
    try {
      const restored = await documentsApi.restoreDocVersion(doc.id, version, actingProfileId());
      // resync the editor fields directly from the returned document — the id-keyed
      // effect below only refires on document *selection* change, not on content
      // changes to the currently-open document (restore/save happen in place).
      setEditTitle(restored.title);
      setEditBody(restored.body ?? "");
      await refetchDocuments();
      await refetchVersions();
    } catch (e) {
      fail(e);
    }
  }

  function renderedMarkdown() {
    try {
      return marked.parse(editBody() || "", { async: false }) as string;
    } catch {
      return "";
    }
  }

  function FolderRow(props: { folder: DocumentFolder; depth: number }) {
    const f = () => props.folder;
    const childFolders = () => scopedFolders().filter((c) => c.parent_id === f().id);
    const childDocs = () => scopedDocuments().filter((d) => d.folder_id === f().id);
    const isOpen = () => expanded().has(f().id);
    return (
      <>
        <li class="folder-row" style={{ "padding-left": `${props.depth * 1.1 + 0.4}em` }}>
          <span class="folder-toggle" onClick={() => toggleExpand(f().id)}>
            {isOpen() ? "▾" : "▸"}
          </span>
          <Show
            when={renamingFolderId() === f().id}
            fallback={
              <span
                class="folder-name"
                classList={{ active: selectedFolderId() === f().id, archived: f().archived }}
                onClick={() => setSelectedFolderId(f().id)}
              >
                {f().name}
              </span>
            }
          >
            <input
              class="folder-rename-input"
              value={renameValue()}
              onInput={(e) => setRenameValue(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && saveRenameFolder(f())}
            />
            <button class="ghost small" onClick={() => saveRenameFolder(f())}>
              ✓
            </button>
          </Show>
          <span class="folder-actions">
            <button class="ghost small" title="rename" onClick={() => startRenameFolder(f())}>
              ✎
            </button>
            <select
              class="folder-move-select"
              title="move to…"
              value=""
              onChange={(e) => e.currentTarget.value && moveFolderTo(f(), e.currentTarget.value)}
            >
              <option value="">move…</option>
              <option value="">root</option>
              <For each={scopedFolders().filter((o) => o.id !== f().id)}>
                {(o) => <option value={o.id}>{o.name}</option>}
              </For>
            </select>
            <button class="ghost small" title="archive/unarchive" onClick={() => toggleFolderArchived(f())}>
              {f().archived ? "restore" : "archive"}
            </button>
          </span>
        </li>
        <Show when={isOpen()}>
          <For each={childDocs()}>
            {(d) => (
              <li style={{ "padding-left": `${(props.depth + 1) * 1.1 + 0.4}em` }}>
                <a
                  class="doc-row"
                  classList={{ active: d.id === selectedDocumentId(), archived: d.archived }}
                  {...linkProps(docRoute(d.id))}
                >
                  <span class="doc-icon">📄</span>
                  <span class="doc-title">{d.title}</span>
                  <span class="doc-version">v{d.version}</span>
                </a>
              </li>
            )}
          </For>
          <For each={childFolders()}>{(c) => <FolderRow folder={c} depth={props.depth + 1} />}</For>
        </Show>
      </>
    );
  }

  return (
    <section class="documents-view">
      <Show when={error()}>
        <div class="error-bar" onClick={() => setError(null)}>
          {error()}
        </div>
      </Show>

      <WorkspaceHeader class="dk-workspace-head" icon="book" title="Knowledge">
        Documents, project notes, and the Knowledge Base share one versioned home.
      </WorkspaceHeader>

      <nav class="container-tabs">
        <For each={CONTAINER_TABS}>
          {(t) => (
            <a
              class="container-tab"
              classList={{ active: activeContainer() === t.key }}
              {...linkProps(containerRoute(t.key))}
              onClick={(event) => {
                linkProps(containerRoute(t.key)).onClick(event);
                if (event.defaultPrevented) {
                  setSelectedFolderId(null);
                  setSelectedDocumentId(null);
                }
              }}
            >
              {t.label}
            </a>
          )}
        </For>

        <Show when={activeContainer() === "project"}>
          <select value={selectedProjectId() ?? ""} onChange={(e) => {
            const id = e.currentTarget.value || null;
            setSelectedProjectId(id);
            linkContainer("project", id ?? undefined);
          }}>
            <For each={projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
          </select>
        </Show>

        <Show when={activeContainer() === "kb"}>
          <select value={selectedBookId() ?? ""} onChange={(e) => {
            const id = e.currentTarget.value || null;
            setSelectedBookId(id);
            linkContainer("kb", id ?? undefined);
          }}>
            <option value="">select a book…</option>
            <For each={books()}>{(b) => <option value={b.id}>{b.name}</option>}</For>
          </select>
          <input placeholder="New book name" value={newBookName()} onInput={(e) => setNewBookName(e.currentTarget.value)} />
          <button class="ghost small" onClick={createBook} disabled={!newBookName().trim()}>
            + Book
          </button>
        </Show>

        <label class="show-archived">
          <input type="checkbox" checked={showArchived()} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
          show archived
        </label>
      </nav>

      <div class="documents-body" style={{ "--col-tree": treeW() + "px" }}>
        <aside class="documents-tree">
          <Show
            when={containerId()}
            fallback={<p class="hint pad">{activeContainer() === "kb" ? "Pick or create a book above." : "Loading…"}</p>}
          >
            <div class="tree-root" classList={{ active: selectedFolderId() === null }} onClick={() => setSelectedFolderId(null)}>
              (root)
            </div>
            <ul class="folder-tree">
              <For each={scopedDocuments().filter((d) => d.folder_id === null)}>
                {(d) => (
                  <li style={{ "padding-left": "0.4em" }}>
                    <a
                      class="doc-row"
                      classList={{ active: d.id === selectedDocumentId(), archived: d.archived }}
                      {...linkProps(docRoute(d.id))}
                    >
                      <span class="doc-icon">📄</span>
                      <span class="doc-title">{d.title}</span>
                      <span class="doc-version">v{d.version}</span>
                    </a>
                  </li>
                )}
              </For>
              <For each={scopedFolders().filter((f) => f.parent_id === rootParentId())}>
                {(f) => <FolderRow folder={f} depth={0} />}
              </For>
            </ul>
            <div class="new-item-forms">
              <div class="new-item-row">
                <input placeholder="New folder name" value={newFolderName()} onInput={(e) => setNewFolderName(e.currentTarget.value)} />
                <button class="ghost small" onClick={createFolder} disabled={!newFolderName().trim()}>
                  + Folder
                </button>
              </div>
              <div class="new-item-row">
                <input placeholder="New document title" value={newDocTitle()} onInput={(e) => setNewDocTitle(e.currentTarget.value)} />
                <button class="primary small" onClick={createDocument} disabled={!newDocTitle().trim()}>
                  + Document
                </button>
              </div>
              <p class="hint">
                Creating into: {selectedFolderId() ? scopedFolders().find((f) => f.id === selectedFolderId())?.name ?? "(root)" : "(root)"}
              </p>
            </div>
          </Show>
        </aside>

        <Resizer width={treeW} setWidth={setTreeW} min={190} max={480} />

        <section class="documents-editor">
          <Show when={selectedDocument()} fallback={<p class="hint pad">Select or create a document.</p>}>
            {(doc) => (
              <>
                <div class="editor-toolbar">
                  <input class="editor-title" value={editTitle()} onInput={(e) => setEditTitle(e.currentTarget.value)} />
                  <span class="version-chip">v{doc().version}</span>
                  <Show when={doc().archived}>
                    <span class="archived-chip">archived</span>
                  </Show>
                  <button class="ghost small" onClick={() => setShowPreview((v) => !v)}>
                    {showPreview() ? "hide preview" : "show preview"}
                  </button>
                  <select value={doc().folder_id ?? ""} onChange={(e) => moveDocumentTo(e.currentTarget.value)}>
                    <option value="">(root)</option>
                    <For each={scopedFolders()}>{(f) => <option value={f.id}>{f.name}</option>}</For>
                  </select>
                  <button class="ghost small" onClick={toggleArchiveDocument}>
                    {doc().archived ? "unarchive" : "archive"}
                  </button>
                  <button class="primary" onClick={saveDocument}>
                    Save version
                  </button>
                </div>

                <div class="editor-panes" classList={{ split: showPreview() }}>
                  <textarea class="editor-body" value={editBody()} onInput={(e) => setEditBody(e.currentTarget.value)} placeholder="Markdown body…" />
                  <Show when={showPreview()}>
                    <div class="editor-preview" innerHTML={renderedMarkdown()} />
                  </Show>
                </div>
              </>
            )}
          </Show>
        </section>

        <Show when={selectedDocument()}>
          <aside class="documents-history">
            <div class="section-label" style="padding:0 0 0.4em">
              Version history
            </div>
            <Show when={!versions.loading} fallback={<p class="hint">Loading…</p>}>
              <ul class="version-list">
                <For each={versions()}>
                  {(v) => (
                    <li classList={{ current: v.version === selectedDocument()?.version }}>
                      <div class="version-head">
                        <strong>v{v.version}</strong>
                        <span class="version-time">{when(v.created_at)}</span>
                      </div>
                      <div class="version-author">{profiles()?.find((p) => p.id === v.created_by)?.display_name ?? v.created_by ?? "—"}</div>
                      <div class="version-snippet">{(v.body ?? "").slice(0, 80) || "(empty)"}</div>
                      <Show when={v.version !== selectedDocument()?.version}>
                        <button class="ghost small" onClick={() => restoreVersion(v.version)}>
                          Restore
                        </button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </aside>
        </Show>
      </div>
    </section>
  );
}
