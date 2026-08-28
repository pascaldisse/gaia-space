import { createResource, createSignal, createEffect, For, Show } from "solid-js";
import PageHeader from "../components/PageHeader";
import { marked } from "marked";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import "../App.css";
import "./Documents.css";
import DocumentCreateDrawer, { type DocumentCreateMode } from "../components/DocumentCreateDrawer";
import { Icon } from "../components/Icon";
import { useDeepLink, linkEntity, linkProps, route } from "../router";
import {
  documentsApi,
  newId,
  type ContainerType,
  type Document,
  type DocumentAccessRecipient,
  type DocumentFolder,
  type DocumentImportSummary,
  type DocumentBodyFormat,
  type DocumentFilePreview,
  type DocumentDiscussion,
  type FavoriteDocument,
} from "../api/documents";
import { chatApi, newId as newMessageId, type MessageView } from "../api/chat";
import { channelFeedsApi } from "../api/channel-feeds";
import { profileId as sessionProfileId, profileLocked, isWeb } from "../session";
import { actingProfileId as chatActingProfileId } from "../chatIdentity";
import { applyMarkdownCommand, sanitizeRichHtml, type MarkdownCommand } from "../richtext";
import { blogsApi, type BlogPost } from "../api/blogs";
import { UI_LOCALE } from "../calendar";

// Two places, not three. A document lives either with a person ("My Documents") or
// with a project ("Project Docs"); the knowledge base is not a third home, it is a
// choice of *source* inside Project Docs (books are org-wide project-shaped shelves).
// The storage containers are unchanged — `kb` is still its own container_type — this
// is purely the navigation the person sees.

function when(ts: number | null) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString(UI_LOCALE, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Documents(props: { container?: ContainerType; containerId?: string } = {}) {
  const [error, setError] = createSignal<string | null>(null);
  const [importOpen, setImportOpen] = createSignal(false);
  /** ── EMBEDDED MEANS THE SCOPE IS ALREADY ANSWERED ────────────────────────
   *
   *  ChannelWorkspace mounts this view for a channel's "Files & Links" tab and
   *  passes the channel's project in. In that mount there is nothing to ask: you
   *  are in the channel, the channel belongs to the project, that IS the project.
   *  So every control whose only job is to CHOOSE A SCOPE is not rendered at all
   *  — not disabled, not shrunk. A disabled picker still asks the question.
   *
   *  Hidden when embedded: the My Documents / Project Docs container toggle, the
   *  project + knowledge-base source picker, the book controls, the "Acting as"
   *  identity picker, and the folder-import path field with its two buttons.
   *  "show archived" STAYS: it filters what you see, it does not pick a scope.
   *
   *  The standalone `#/documents` route passes no props, so it keeps every one of
   *  them — there the scope genuinely is unknown.
   */
  const embedded = () => props.container !== undefined;
  const fail = (e: unknown) => setError(String(e));

  // Identity law: in web mode the personal container is the *session's* profile and
  // nothing the UI offers can change it (`profileLocked()`), matching the server, which
  // rebinds `created_by`/`container_id` from the cookie session and ignores client claims.
  // Desktop (local sqlite, no session) keeps the explicit operator profile choice.
  const [profiles] = createResource(() => documentsApi.listProfiles());
  const [teams] = createResource(() => documentsApi.listTeams());
  const [localProfileId, setLocalProfileId] = createSignal<string | null>(null);
  const actingProfileId = () => (profileLocked() ? sessionProfileId() || null : localProfileId());
  const setActingProfileId = (id: string | null) => { if (!profileLocked()) setLocalProfileId(id); };
  createEffect(() => {
    if (profileLocked()) return;
    const list = profiles();
    if (!list?.length || localProfileId()) return;
    // Inherit the shell's acting profile; the first profile is only a last resort
    // for a desktop that has not chosen one yet.
    const inherited = chatActingProfileId() ?? sessionProfileId();
    setLocalProfileId(list.find((person) => person.id === inherited)?.id ?? list[0].id);
  });

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
  const rootParentId = () => {
    if (activeContainer() === "kb") return selectedBookId();
    if (activeContainer() === "project") return projectRoot()?.id ?? null;
    return null;
  };

  // Favourites are pointers, not copies: a project document starred here still lives in
  // its project. This is what makes "My Documents" the first stop — your own work plus
  // the work you follow — without duplicating anything.
  const [favorites, { refetch: refetchFavorites }] = createResource(
    actingProfileId,
    (id) => (id ? documentsApi.listFavorites(id) : Promise.resolve([] as FavoriteDocument[])),
  );
  // Shelves in read order: unfiled first, then named shelves alphabetically. The order
  // comes from the backend; this only groups the rows it already sorted.
  const favoriteShelves = () => {
    const shelves: { name: string | null; items: FavoriteDocument[] }[] = [];
    for (const item of favorites() ?? []) {
      const name = item.group_name ?? null;
      const last = shelves[shelves.length - 1];
      if (last && last.name === name) last.items.push(item);
      else shelves.push({ name, items: [item] });
    }
    return shelves;
  };
  const favoriteGroups = () =>
    [...new Set((favorites() ?? []).map((f) => f.group_name).filter((n): n is string => !!n))].sort();
  async function moveFavorite(item: FavoriteDocument, delta: number) {
    const actor = actingProfileId();
    if (!actor) return;
    try {
      await documentsApi.moveFavorite(actor, item.id, item.group_name, item.position + delta);
      await refetchFavorites();
    } catch (e) {
      fail(e);
    }
  }
  async function fileFavorite(item: FavoriteDocument, group: string | null) {
    const actor = actingProfileId();
    if (!actor) return;
    try {
      await documentsApi.moveFavorite(actor, item.id, group, 0);
      await refetchFavorites();
    } catch (e) {
      fail(e);
    }
  }
  const favoriteIds = () => new Set((favorites() ?? []).map((d) => d.id));
  const [newShelfFor, setNewShelfFor] = createSignal<string | null>(null);
  const isFavorite = (id: string | null) => !!id && favoriteIds().has(id);
  async function toggleFavorite(documentId: string) {
    const actor = actingProfileId();
    if (!actor) return;
    try {
      await documentsApi.setFavorite(actor, documentId, !isFavorite(documentId));
      await refetchFavorites();
    } catch (e) {
      fail(e);
    }
  }

  const [allFolders, { refetch: refetchFolders }] = createResource(() => documentsApi.listDocumentFolders());
  const [allDocuments, { refetch: refetchDocuments }] = createResource(() => documentsApi.listDocuments());
  // The backend creates this canonical root atomically and reparents legacy direct rows.
  const [projectRoot, { refetch: refetchProjectRoot }] = createResource(
    () => activeContainer() === "project" ? selectedProjectId() : null,
    (id) => id ? documentsApi.ensureProjectDocumentRoot(id) : Promise.resolve(null),
  );

  createEffect((previousRootId: string | null | undefined) => {
    const rootId = projectRoot()?.id ?? null;
    if (rootId && rootId !== previousRootId) void Promise.all([refetchFolders(), refetchDocuments()]);
    return rootId;
  }, null);
  // Reading an errored resource THROWS in Solid. The source picker is now always
  // mounted (it is the Project Docs control itself), so this reader must survive a
  // failed fetch — otherwise the whole view dies and the error-bar never renders (H7).
  const books = () =>
    (allFolders.error ? [] : allFolders() ?? []).filter((f) => f.container_type === "kb" && f.parent_id === null);
  createEffect(() => {
    if (activeContainer() === "kb" && !selectedBookId() && books().length) setSelectedBookId(books()[0].id);
  });

  const [bookQuery, setBookQuery] = createSignal("");
const [bookSearch] = createResource(
() => ({ bookId: selectedBookId(), query: bookQuery().trim() }),
({ bookId, query }) => bookId && query ? documentsApi.searchBookDocuments(bookId, query) : Promise.resolve([]),
);
const [bookAccess, { refetch: refetchBookAccess }] = createResource(selectedBookId, (id) =>
id ? documentsApi.listBookAccess(id) : Promise.resolve([]),
);
const [showBookAccess, setShowBookAccess] = createSignal(false);
async function addBookAccessRecipient() {
const bookId = selectedBookId(); const recipientId = shareRecipientId();
if (!bookId || !recipientId) return;
const next = (bookAccess() ?? []).filter((entry) => entry.recipient_type !== shareRecipientType() || entry.recipient_id !== recipientId);
next.push({ recipient_type: shareRecipientType(), recipient_id: recipientId, access_level: shareAccessLevel() });
try { await documentsApi.updateBookAccess(bookId, next); await refetchBookAccess(); setShareRecipientId(""); } catch (e) { fail(e); }
}
async function removeBookAccessRecipient(permission: DocumentAccessRecipient) {
const bookId = selectedBookId(); if (!bookId) return;
try { await documentsApi.updateBookAccess(bookId, (bookAccess() ?? []).filter((entry) => entry.recipient_type !== permission.recipient_type || entry.recipient_id !== permission.recipient_id)); await refetchBookAccess(); } catch (e) { fail(e); }
}
const [showArchived, setShowArchived] = createSignal(false);

  const treeLoading = () => allFolders.loading || allDocuments.loading;
  const loadFailure = () => {
    const e = allFolders.error ?? allDocuments.error;
    return e ? `Documents could not be loaded: ${String(e)}` : null;
  };

  /** Reading an errored resource throws in Solid. The library canvas must survive a
   *  failed fetch, so it asks through this gate: no documents while loading or broken,
   *  which keeps the error-bar the visible state (SPEC H7). */
  const safeDocuments = () => (treeLoading() || loadFailure() ? [] : scopedDocuments());
  const safeFolders = () => (treeLoading() || loadFailure() ? [] : displayFolders());

  /** THE BIG SURFACE IS THE LIBRARY, not a leftover. It shows the level you are on —
   *  the selected folder, or the container's root — with folders and documents as
   *  cards, so an uploaded file is readable there instead of only as a small row in
   *  the narrow tree. `folder_id === null` counts as root in every container, because
   *  project and book roots are stored as a folder row while personal docs are not. */
  const levelId = () => selectedFolderId() ?? rootParentId();
  const atRoot = () => selectedFolderId() === null;
  const libraryDocuments = () =>
    safeDocuments().filter((d) => d.folder_id === levelId() || (atRoot() && d.folder_id === null));
  const libraryFolders = () =>
    safeFolders().filter((f) => f.parent_id === levelId() || (atRoot() && f.parent_id === null));
  const levelFolder = () => safeFolders().find((f) => f.id === selectedFolderId()) ?? null;
  const containerName = () => {
    if (embedded()) return "Project library";
    if (activeContainer() === "my-docs") return "My Documents";
    if (activeContainer() === "kb") return books().find((b) => b.id === selectedBookId())?.name ?? "Organization library";
    return projects()?.find((p) => p.id === selectedProjectId())?.name ?? "Project library";
  };
  const libraryTitle = () => levelFolder()?.name ?? containerName();
  /** The whole way down, so a deep shelf can be left in one click at any level —
   *  "Back" only ever answered one step and, sitting in the canvas, it answered it
   *  from the middle of the page. */
  const folderPath = () => {
    const chain: DocumentFolder[] = [];
    let current = levelFolder();
    const guard = new Set<string>();
    while (current && !guard.has(current.id)) {
      guard.add(current.id);
      chain.unshift(current);
      const parentId = current.parent_id;
      current = parentId && parentId !== rootParentId() ? safeFolders().find((f) => f.id === parentId) ?? null : null;
    }
    return chain;
  };

  /** ── THE SHELF ─────────────────────────────────────────────────────────────
   *
   *  Folders stand side by side like books on a shelf and are DROP TARGETS: a
   *  document (or another folder) dragged onto one is filed inside it. This is the
   *  structural half of the library — the part that has to exist before there is
   *  enough material to need it. Payloads are plain text so the same handler can
   *  tell an internal drag from a file drop (which carries `Files` instead).
   */
  const [dropTargetId, setDropTargetId] = createSignal<string | null>(null);
  const folderCount = (id: string) => ({
    documents: safeDocuments().filter((d) => d.folder_id === id).length,
    folders: safeFolders().filter((f) => f.parent_id === id).length,
  });
  const shelfSubline = (id: string) => {
    const { documents, folders } = folderCount(id);
    if (!documents && !folders) return "Empty shelf";
    const parts: string[] = [];
    if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
    if (documents) parts.push(`${documents} document${documents === 1 ? "" : "s"}`);
    return parts.join(" · ");
  };
  const isInternalDrag = (event: DragEvent) => !event.dataTransfer?.types.includes("Files");
  /** `null` files at the level's root; the backend wants the project root row there. */
  async function fileInto(payload: string, targetFolderId: string | null) {
    const cid = containerId();
    if (!cid) return;
    const [kind, ...rest] = payload.split(":");
    const id = rest.join(":");
    if (!id) return;
    const root = activeContainer() === "my-docs" ? null : rootParentId();
    try {
      if (kind === "document" || kind === "favorite") {
        const doc = scopedDocuments().find((d) => d.id === id);
        if (!doc || doc.folder_id === (targetFolderId ?? root)) return;
        await documentsApi.moveDocument(doc.id, doc.container_type, cid, targetFolderId ?? root);
        await refetchDocuments();
      } else if (kind === "folder") {
        // A shelf cannot be filed into itself, nor into a shelf it already holds.
        if (id === targetFolderId) return;
        const descends = (folderId: string | null): boolean => {
          if (!folderId) return false;
          if (folderId === id) return true;
          const parent = safeFolders().find((f) => f.id === folderId)?.parent_id ?? null;
          return descends(parent);
        };
        if (descends(targetFolderId)) return;
        await documentsApi.moveDocumentFolder(id, targetFolderId ?? root);
        await refetchFolders();
      }
    } catch (e) {
      fail(e);
    }
  }

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

  const displayFolders = () => scopedFolders().filter((f) => f.id !== rootParentId());
  const projectReady = () => activeContainer() !== "project" || !!projectRoot();
  const [selectedFolderId, setSelectedFolderId] = createSignal<string | null>(null);
  // The tree column is gone (the library canvas IS the page), so nothing expands
  // in place any more: opening a folder navigates one level, with Back to return.

  // ---- import (Confluence export / local notes folder) ----
  // Both are the same shape on disk; the Rust side mirrors the directory tree into folders.
  const [importPath, setImportPath] = createSignal("");
  const [importing, setImporting] = createSignal(false);
  const [importSummary, setImportSummary] = createSignal<DocumentImportSummary | null>(null);
  async function chooseImportFolder() {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: "Import document folder" });
      if (typeof selected === "string") setImportPath(selected);
    } catch (e) {
      // Browser/server mode has no native picker; the path field remains usable there.
      setError(`Folder picker unavailable: ${String(e)}`);
    }
  }
  async function runImport() {
    const path = importPath().trim();
    const cid = containerId();
    if (!path || !cid) return;
    setImporting(true);
    setImportSummary(null);
    try {
      const summary = await documentsApi.importFolder({
        source_path: path,
        container_type: activeContainer(),
        container_id: cid,
        parent_folder_id: selectedFolderId() ?? rootParentId(),
        created_by: localProfileId(),
      });
      setImportSummary(summary);
      setImportPath("");
      await Promise.all([refetchProjectRoot(), refetchFolders(), refetchDocuments()]);
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
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
      await documentsApi.createDocumentFolder(folder, actingProfileId());
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
      await documentsApi.createDocumentFolder(folder, actingProfileId());
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

  // ---- document CRUD ----
  const [newDocTitle, setNewDocTitle] = createSignal("");
const [newDocBodyFormat, setNewDocBodyFormat] = createSignal<DocumentBodyFormat>("text");
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
      // In KB the book row *is* the root, so an unfiled article belongs to the book,
      // not to `null` — otherwise it would be written where the tree cannot show it.
      folder_id: selectedFolderId() ?? rootParentId(),
      doc_type: "text",
      body_format: newDocBodyFormat(),
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
async function changeBodyFormat(doc: Document, bodyFormat: DocumentBodyFormat) {
if (doc.body_format === bodyFormat) return;
try { await documentsApi.updateDocument({ ...doc, body_format: bodyFormat }); await refetchDocuments(); } catch (e) { fail(e); }
}
  // A document URL carries its container, so a cold direct link restores the same tree the
  // in-app click would have opened (tab + project/book selection), not just the id.
  const docRoute = (id:string, container:ContainerType = activeContainer(), cid:string|null = containerId()) =>
    ({ view:"Documents", entityType:"document", entityId:id, containerType:container, containerId:cid ?? undefined });
  const applyContainer = (container:string, cid?:string) => {
    if (container !== activeContainer()) setActiveContainer(container as ContainerType);
    if (!cid) return;
    if (container === "project") setSelectedProjectId(cid);
    else if (container === "kb") setSelectedBookId(cid);
    // A `my-docs` URL never re-points the personal container in web mode: the session
    // owns that identity, so a forged `/documents/my-docs/<someone-else>` link resolves
    // to your own container instead of theirs.
    else if (container === "my-docs") setActingProfileId(cid);
  };
  // route -> container switch (direct link / back / forward)
  createEffect(() => {
    const r = route();
    if (r.view !== "Documents" || !r.containerType) return;
    applyContainer(r.containerType, r.containerId);
  });
  // embedded -> container switch. The channel workspace mounts this same view for its
  // "Dateien und Links" tab, where the container comes from the channel's project instead
  // of from the URL (the URL is the channel's). No route is written: the address bar keeps
  // naming the channel.
  createEffect(() => {
    if (!props.container) return;
    applyContainer(props.container, props.containerId);
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
  const [access, { refetch: refetchAccess }] = createResource(selectedDocumentId, (id) =>
    id ? documentsApi.listDocumentAccess(id) : Promise.resolve([]),
  );
  const [discussion, { refetch: refetchDiscussion }] = createResource(selectedDocumentId, (id) =>
    id ? documentsApi.getDocumentDiscussion(id) : Promise.resolve(null as DocumentDiscussion | null),
  );
  const [discussionMessages, { refetch: refetchDiscussionMessages }] = createResource(
    () => discussion()?.channel_id ?? null,
    (channelId) => channelId ? chatApi.listMessages(channelId, actingProfileId()) : Promise.resolve([] as MessageView[]),
  );
  const [commentText, setCommentText] = createSignal("");
  const [meetingBinding, setMeetingBinding] = createSignal("");
  async function attachDiscussion() {
    const doc = selectedDocument();
    if (!doc) return;
    try {
      const item = await documentsApi.attachDocumentDiscussion(doc.id, meetingBinding().trim() || null);
      setMeetingBinding(item.meeting_id ?? "");
      await refetchDiscussion();
    } catch (e) { fail(e); }
  }
  async function sendComment() {
    const channelId = discussion()?.channel_id;
    const actor = actingProfileId();
    const text = commentText().trim();
    if (!channelId || !actor || !text) return;
    try {
      await chatApi.createMessage({ id: newMessageId("message"), channel_id: channelId, author_id: actor, text, created_at: Math.floor(Date.now() / 1000), edited_at: null, thread_of: null, archived: false });
      setCommentText("");
      await refetchDiscussionMessages();
    } catch (e) { fail(e); }
  }
  async function react(message: MessageView, emoji: string) {
    const actor = actingProfileId();
    if (!actor) return;
    try {
      const prior = message.reactions.find((item) => item.emoji === emoji);
      if (prior?.mine) await chatApi.removeReaction(message.id, actor, emoji);
      else await chatApi.addReaction(message.id, actor, emoji);
      await refetchDiscussionMessages();
    } catch (e) { fail(e); }
  }
  function CommentPanel() {
    const [subscriptions, { refetch }] = createResource(() => actingProfileId(), (id) => id ? channelFeedsApi.list(id) : Promise.resolve([]));
    const subscribed = () => subscriptions()?.some((entry) => entry.channel_id === discussion()?.channel_id && entry.enabled) ?? false;
    const toggleFeed = async (enabled: boolean) => {
      const channelId = discussion()?.channel_id;
      const actor = actingProfileId();
      if (!channelId || !actor) return;
      try { await channelFeedsApi.save({ channel_id: channelId, profile_id: actor, enabled }); await refetch(); } catch (e) { fail(e); }
    };
    return <section class="document-comments" aria-label="Article comments">
      <div class="comments-head"><strong>Comments</strong><span class="hint">Article discussion</span></div>
      <Show when={discussion()} fallback={<button class="ghost small" onClick={attachDiscussion}>Start discussion</button>}>
        {(item) => <>
          <div class="meeting-binding"><input aria-label="Meeting ID binding" placeholder="Meeting ID (optional)" value={meetingBinding() || item().meeting_id || ""} onInput={(e) => setMeetingBinding(e.currentTarget.value)} /><button class="ghost small" onClick={attachDiscussion}>Bind meeting</button></div>
          <label class="comment-feed"><input type="checkbox" checked={subscribed()} onChange={(e) => void toggleFeed(e.currentTarget.checked)} /> Send activity to #Spacebox</label>
          <div class="comment-list"><For each={discussionMessages() ?? []}>{(message) => <article class="comment-row"><p>{message.text}</p><div><For each={message.reactions}>{(reaction) => <button class="ghost small" classList={{ active: reaction.mine }} onClick={() => react(message, reaction.emoji)}>{reaction.emoji} {reaction.count}</button>}</For><button class="ghost small" onClick={() => react(message, "👍")}>👍</button><button class="ghost small" onClick={() => react(message, "❤️")}>❤️</button></div></article>}</For></div>
          <div class="comment-compose"><textarea aria-label="Write a comment" value={commentText()} onInput={(e) => setCommentText(e.currentTarget.value)} placeholder="Write a comment…" /><button class="primary small" onClick={sendComment} disabled={!commentText().trim() || !actingProfileId()}>Comment</button></div>
        </>}
      </Show>
    </section>;
  }
  const [showSharing, setShowSharing] = createSignal(false);

  // ---- uploaded files ----
  // An upload is a document with doc_type='file': the tree, folders and permissions are
  // the ordinary ones, only the payload lives outside the row. Preview is fetched lazily
  // and capped by the backend, so selecting a large upload never pulls the whole file.
  const [uploadPath, setUploadPath] = createSignal("");
  const [uploading, setUploading] = createSignal(false);
  // In a browser the operator has no filesystem we can name: the bytes must be sent.
  // The desktop keeps the path field (it can read the disk it is running on).
  // Progress is per file and reported by the transport, never guessed from a timer.
  const [uploadProgress, setUploadProgress] = createSignal<{ name: string; fraction: number } | null>(null);
  const [dragOver, setDragOver] = createSignal(false);
  async function uploadBrowserFiles(files: File[]) {
    const cid = containerId();
    if (!cid || files.length === 0) return;
    setUploading(true);
    try {
      let last: string | null = null;
      for (const file of files) {
        setUploadProgress({ name: file.name, fraction: 0 });
        const uploaded = await documentsApi.uploadWebFileWithProgress(
          file,
          {
            container_type: activeContainer(),
            container_id: cid,
            folder_id: selectedFolderId() ?? rootParentId(),
            title: file.name,
          },
          (fraction) => setUploadProgress({ name: file.name, fraction }),
        );
        last = uploaded.document_id;
      }
      await refetchDocuments();
      if (last) setSelectedDocumentId(last);
    } catch (e) {
      fail(e);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }
  const uploadBrowserFile = (file: File) => uploadBrowserFiles([file]);
  // Dropping onto the tree files the bytes exactly where a click would have: the
  // selected folder of the container you are looking at.
  function onTreeDrop(event: DragEvent) {
    setDragOver(false);
    const dropped = Array.from(event.dataTransfer?.files ?? []);
    if (!isWeb() || dropped.length === 0) return;
    event.preventDefault();
    void uploadBrowserFiles(dropped);
  }
  async function uploadFile() {
    const path = uploadPath().trim();
    const cid = containerId();
    if (!path || !cid) return;
    setUploading(true);
    try {
      const file = await documentsApi.uploadFile({
        source_path: path,
        container_type: activeContainer(),
        container_id: cid,
        // Project uploads are documents too: their canonical root is mandatory.
        folder_id: selectedFolderId() ?? rootParentId(),
        created_by: actingProfileId(),
      });
      setUploadPath("");
      await refetchDocuments();
      setSelectedDocumentId(file.document_id);
    } catch (e) {
      fail(e);
    } finally {
      setUploading(false);
    }
  }
  /** Desktop upload without typing a path.
   *
   *  `upload_document_file` names a path on the BACKEND filesystem — it takes a
   *  path, not bytes — so in the desktop build the honest way to "just upload a
   *  file" is the native picker, which hands back a real path. That is also why
   *  drag-and-drop of dropped bytes stays gated on `isWeb()` further down: the
   *  web transport can post the bytes, the invoke command cannot receive them.
   *  Nothing here fakes a path for a dropped file. */
  async function pickAndUploadFile() {
    try {
      const picked = await openDialog({ directory: false, multiple: false, title: "Upload a file" });
      if (typeof picked !== "string") return;
      setUploadPath(picked);
      await uploadFile();
    } catch (e) {
      fail(e);
    }
  }

  // The embedded surface offers two acts, so the few facts each needs are asked
  // in a drawer at the moment you ask for them, not in a permanent column.
  const [createMode, setCreateMode] = createSignal<DocumentCreateMode | null>(null);
  const [creating, setCreating] = createSignal(false);
  const openCreate = (mode: DocumentCreateMode) => {
    if (mode === "document") setNewDocTitle(""); else setNewFolderName("");
    setCreateMode(mode);
  };
  async function submitCreate() {
    const mode = createMode();
    if (!mode) return;
    setCreating(true);
    setError(null);
    try {
      if (mode === "document") await createDocument();
      else await createFolder();
      // createDocument/createFolder report their own failure through `fail()`;
      // the drawer closes only when nothing was reported.
      if (!error()) setCreateMode(null);
    } finally {
      setCreating(false);
    }
  }
  // Where a new item lands, as a sentence — the destination is a fact here, not a picker.
  const createScopeLabel = () => {
    const folder = selectedFolderId() ? scopedFolders().find((f) => f.id === selectedFolderId())?.name : null;
    const place = activeContainer() === "project"
      ? projects()?.find((p) => p.id === containerId())?.name ?? "this project"
      : activeContainer() === "kb"
        ? books().find((b) => b.id === containerId())?.name ?? "this book"
        : "your documents";
    return folder ? `${place} / ${folder}` : place;
  };

  const [filePreview] = createResource(
    () => (selectedDocument()?.doc_type === "file" ? selectedDocumentId() : null),
    (id) => (id ? documentsApi.readDocumentFile(id) : Promise.resolve(null)),
  );
  const previewDataUrl = (p: DocumentFilePreview) =>
    p.data_base64 ? `data:${p.mime};base64,${p.data_base64}` : "";
  // The stored bytes have a stable URL in web mode: that is what makes a PDF viewable
  // in the browser and every other type downloadable, instead of "it is on some disk".
  const fileHref = (documentId: string) =>
    isWeb() ? `${import.meta.env.BASE_URL}api/documents/files/${documentId}` : "";
  // Office documents are zip archives, so nothing but a real reader can show them.
  // Both readers are pure-JS and loaded on demand: a person who never opens a .docx
  // never downloads the converter.
  const OFFICE_MIME: Record<string, "docx" | "xlsx"> = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xlsx",
  };
  const officeKind = (preview: DocumentFilePreview): "docx" | "xlsx" | null => {
    const byMime = OFFICE_MIME[preview.mime];
    if (byMime) return byMime;
    const name = preview.filename.toLowerCase();
    if (name.endsWith(".docx")) return "docx";
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
    return null;
  };
  const base64ToBytes = (value: string) => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };
  async function officeBytes(documentId: string, preview: DocumentFilePreview): Promise<ArrayBuffer> {
    // Web has the whole file behind a URL; desktop has the preview payload, which the
    // backend may have capped — a truncated archive is unreadable, and says so.
    if (isWeb()) {
      const response = await fetch(fileHref(documentId), { credentials: "include" });
      if (!response.ok) throw new Error(`could not read the file (HTTP ${response.status})`);
      return await response.arrayBuffer();
    }
    if (!preview.data_base64) throw new Error("no bytes available for this file");
    if (preview.truncated) throw new Error("the stored preview is truncated, so the archive cannot be opened");
    return base64ToBytes(preview.data_base64).buffer as ArrayBuffer;
  }
  function OfficePreview(props: { preview: DocumentFilePreview; kind: "docx" | "xlsx" }) {
    const [rendered] = createResource(
      () => ({ id: selectedDocumentId(), preview: props.preview, kind: props.kind }),
      async ({ id, preview, kind }) => {
        if (!id) return null;
        const bytes = await officeBytes(id, preview);
        if (kind === "docx") {
          const mammoth = await import("mammoth");
          const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
          return sanitizeRichHtml(result.value);
        }
        const XLSX = await import("xlsx");
        const book = XLSX.read(bytes, { type: "array" });
        // Every sheet, each under its own name: a workbook is not just its first tab.
        return book.SheetNames.map((name) =>
          `<h3>${name.replace(/[<>&]/g, "")}</h3>${sanitizeRichHtml(XLSX.utils.sheet_to_html(book.Sheets[name]))}`,
        ).join("");
      },
    );
    return (
      <div class="office-preview">
        <Show when={!rendered.loading} fallback={<p class="hint" role="status">Rendering {props.preview.filename}…</p>}>
          <Show
            when={!rendered.error}
            fallback={<p class="error-bar" role="alert">{String(rendered.error)}</p>}
          >
            <div class="office-body" innerHTML={rendered() ?? ""} />
          </Show>
        </Show>
      </div>
    );
  }

  function FilePreview(props: { preview: DocumentFilePreview }) {
    const p = () => props.preview;
    return (
      <div class="file-preview" data-mime={p().mime}>
        <div class="file-meta">
          <strong>{p().filename}</strong>
          <span>{p().mime}</span>
          <span>{p().size} bytes</span>
          <Show when={p().truncated}><span class="hint">preview truncated</span></Show>
        </div>
        <Show when={p().mime.startsWith("image/")}>
          <img class="file-image" src={previewDataUrl(p())} alt={p().filename} />
        </Show>
        <Show when={p().text !== null}>
          <pre class="file-text">{p().text}</pre>
        </Show>
        <Show when={isWeb() && p().mime === "application/pdf"}>
          <object
            class="file-pdf"
            data={fileHref(selectedDocumentId() ?? "")}
            type="application/pdf"
            aria-label={`PDF preview of ${p().filename}`}
          >
            <a href={fileHref(selectedDocumentId() ?? "")}>Open {p().filename}</a>
          </object>
        </Show>
        <Show when={isWeb()}>
          <p>
            <a class="file-download" href={fileHref(selectedDocumentId() ?? "")} download={p().filename}>
              ↓ Download {p().filename}
            </a>
          </p>
        </Show>
        <Show when={officeKind(p())}>
          {(kind) => <OfficePreview preview={p()} kind={kind()} />}
        </Show>
        <Show when={
          p().text === null
          && !p().mime.startsWith("image/")
          && !officeKind(p())
          && !(isWeb() && p().mime === "application/pdf")
        }>
          <p class="hint">No inline preview for this type — the file is stored beside the database.</p>
        </Show>
      </div>
    );
  }

  // ---- blog draft workflow ----
  // A personal document is the draft; publishing promotes it into a blog article that
  // keeps pointing back at the draft (`draft_id`), so the control is state, not a wish:
  // the article's existence — archived or not — decides which button is shown.
  const [blogArticle, { refetch: refetchBlogArticle }] = createResource(selectedDocumentId, async (id) => {
    if (!id) return null;
    try {
      const posts = await blogsApi.list({ include_archived: true });
      return posts.find((p) => p.draft_id === id) ?? null;
    } catch {
      return null; // blog surface unavailable: publishing simply is not offered
    }
  });
  const canPublishToBlog = () => {
    const doc = selectedDocument();
    return !!doc && doc.container_type === "my-docs" && !doc.archived && doc.created_by === actingProfileId();
  };
  async function publishDraftToBlog() {
    const doc = selectedDocument();
    const author = actingProfileId();
    if (!doc || !author) return;
    try {
      await blogsApi.publish({
        draft_id: doc.id,
        author_id: author,
        team_id: null,
        project_id: activeContainer() === "project" ? selectedProjectId() : null,
        location_id: null,
      });
      await refetchBlogArticle();
    } catch (e) {
      fail(e);
    }
  }
  async function setBlogArchived(post: BlogPost, archived: boolean) {
    try {
      await blogsApi.archive(post.id, archived, actingProfileId());
      await refetchBlogArticle();
    } catch (e) {
      fail(e);
    }
  }

  // ---- publication (public link) ----
  const [publication, { refetch: refetchPublication }] = createResource(selectedDocumentId, (id) =>
    id ? documentsApi.getPublication(id) : Promise.resolve(null),
  );
  async function togglePublished() {
    const id = selectedDocumentId();
    const current = publication();
    if (!id || !current) return;
    try {
      await documentsApi.publishDocument(id, !current.published);
      await refetchPublication();
    } catch (e) {
      setError(String(e));
    }
  }
  const [shareRecipientType, setShareRecipientType] = createSignal<"profile" | "team">("profile");
  const [shareRecipientId, setShareRecipientId] = createSignal("");
  const [shareAccessLevel, setShareAccessLevel] = createSignal<"viewer" | "editor">("viewer");
  const canManageAccess = () => {
    const doc = selectedDocument();
    return doc?.container_type === "my-docs" && doc.created_by === actingProfileId();
  };
  const recipientName = (permission: DocumentAccessRecipient) =>
    permission.recipient_type === "profile"
      ? profiles()?.find((p) => p.id === permission.recipient_id)?.display_name ?? permission.recipient_id
      : teams()?.find((t) => t.id === permission.recipient_id)?.name ?? permission.recipient_id;
  async function saveAccess(next: DocumentAccessRecipient[]) {
    const doc = selectedDocument();
    if (!doc) return;
    try {
      await documentsApi.updateDocumentAccess(doc.id, next);
      await refetchAccess();
    } catch (e) {
      fail(e);
    }
  }
  async function addAccessRecipient() {
    const recipientId = shareRecipientId();
    if (!recipientId) return;
    const next = (access() ?? []).filter(
      (entry) => entry.recipient_type !== shareRecipientType() || entry.recipient_id !== recipientId,
    );
    next.push({ recipient_type: shareRecipientType(), recipient_id: recipientId, access_level: shareAccessLevel() });
    await saveAccess(next);
    setShareRecipientId("");
  }
  async function removeAccessRecipient(permission: DocumentAccessRecipient) {
    await saveAccess((access() ?? []).filter(
      (entry) => entry.recipient_type !== permission.recipient_type || entry.recipient_id !== permission.recipient_id,
    ));
  }

  async function saveDocument() {
    const doc = selectedDocument();
    if (!doc) return;
    try {
      // rich-text is stored as HTML and rendered with innerHTML, so it is sanitized on
      // the way in as well as on the way out — a hostile paste must never reach the row.
      const body = doc.body_format === "rich-text" ? sanitizeRichHtml(editBody()) : editBody();
      const saved = await documentsApi.saveDocument(doc.id, editTitle().trim() || doc.title, body, actingProfileId());
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
      await documentsApi.moveDocument(doc.id, doc.container_type, cid, folderId === "" ? (activeContainer() === "project" ? rootParentId() : null) : folderId);
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

  type ChecklistLine = { text: string; done: boolean };
  function checklistLines(body: string): ChecklistLine[] {
    return body.split("\n").filter((line) => line.trim()).map((line) => {
      const match = line.match(/^\s*(?:[-*]\s*)?\[([ xX])\]\s*(.*)$/);
      return match ? { text: match[2], done: match[1].toLowerCase() === "x" } : { text: line.trim(), done: false };
    });
  }
  function toggleChecklistLine(index: number) {
    let item = -1;
    setEditBody(editBody().split("\n").map((line) => {
      if (!line.trim()) return line;
      item += 1;
      if (item !== index) return line;
      const match = line.match(/^(\s*(?:[-*]\s*)?\[)([ xX])(\]\s*.*)$/);
      return match ? `${match[1]}${match[2].toLowerCase() === "x" ? " " : "x"}${match[3]}` : `- [x] ${line.trim()}`;
    }).join("\n"));
  }
  function codePresentation(body: string) {
    const match = body.match(/^```([\w+-]+)?\n?([\s\S]*?)\n?```\s*$/);
    return { language: match?.[1] || "plain text", source: match?.[2] ?? body };
  }
  function CodeRenderer() {
    const code = () => codePresentation(editBody());
    return <div class="document-renderer code-renderer" data-format="code" data-language={code().language}>
      <div class="code-language">{code().language}</div>
      <pre><code><For each={code().source.split("\n")}>{(line, index) => <span class="code-line"><span class="code-line-number" aria-hidden="true">{index() + 1}</span><span>{line}{index() < code().source.split("\n").length - 1 ? "\n" : ""}</span></span>}</For></code></pre>
    </div>;
  }
  function DocumentRenderer(props: { format: () => DocumentBodyFormat }) {
    return <Show when={props.format()} keyed>{(format) => {
      if (format === "rich-text") return <div class="document-renderer rich-text-renderer" data-format="rich-text" innerHTML={sanitizeRichHtml(editBody())} />;
      if (format === "checklist") return <ul class="document-renderer checklist-renderer" data-format="checklist"><For each={checklistLines(editBody())}>{(item, index) => <li classList={{ done: item.done }}><label><input type="checkbox" checked={item.done} onChange={() => toggleChecklistLine(index())} /><span>{item.text}</span></label></li>}</For></ul>;
      if (format === "code") return <CodeRenderer />;
      return <div class="document-renderer markdown-renderer" data-format="text" innerHTML={renderedMarkdown()} />;
    }}</Show>;
  }

  // ---- editing surfaces ----
  const MD_BUTTONS: { cmd: MarkdownCommand; label: string; title: string }[] = [
    { cmd: "bold", label: "B", title: "Bold" },
    { cmd: "italic", label: "I", title: "Italic" },
    { cmd: "strike", label: "S", title: "Strikethrough" },
    { cmd: "code", label: "<>", title: "Inline code" },
    { cmd: "h1", label: "H1", title: "Heading 1" },
    { cmd: "h2", label: "H2", title: "Heading 2" },
    { cmd: "h3", label: "H3", title: "Heading 3" },
    { cmd: "ul", label: "•–", title: "Bullet list" },
    { cmd: "ol", label: "1.", title: "Numbered list" },
    { cmd: "quote", label: "”", title: "Quote" },
    { cmd: "link", label: "🔗", title: "Link" },
  ];
  // execCommand is deprecated but is still the only cross-browser way to edit a
  // contenteditable selection without shipping a document model; output is sanitized.
  const RICH_BUTTONS: { cmd: string; arg?: string; label: string; title: string }[] = [
    { cmd: "bold", label: "B", title: "Bold" },
    { cmd: "italic", label: "I", title: "Italic" },
    { cmd: "underline", label: "U", title: "Underline" },
    { cmd: "strikeThrough", label: "S", title: "Strikethrough" },
    { cmd: "formatBlock", arg: "h2", label: "H2", title: "Heading 2" },
    { cmd: "formatBlock", arg: "h3", label: "H3", title: "Heading 3" },
    { cmd: "insertUnorderedList", label: "•–", title: "Bullet list" },
    { cmd: "insertOrderedList", label: "1.", title: "Numbered list" },
    { cmd: "formatBlock", arg: "blockquote", label: "”", title: "Quote" },
    { cmd: "removeFormat", label: "✗", title: "Clear formatting" },
  ];

  let bodyArea: HTMLTextAreaElement | undefined;
  function runMarkdownCommand(cmd: MarkdownCommand) {
    const area = bodyArea;
    if (!area) return;
    const result = applyMarkdownCommand(editBody(), { start: area.selectionStart, end: area.selectionEnd }, cmd);
    setEditBody(result.body);
    // Restore the caret after Solid flushes the new value, or a second click would
    // operate on a collapsed selection at position 0.
    queueMicrotask(() => {
      area.focus();
      area.setSelectionRange(result.start, result.end);
    });
  }

  let richArea: HTMLDivElement | undefined;
  // Seed from the in-progress buffer when there is one, else from the stored row: the
  // ref can run before the buffer-sync effect has copied the freshly selected document.
  const richSeed = () => sanitizeRichHtml(editBody() || selectedDocument()?.body || "");
  // The contenteditable is only re-seeded when the *document* changes: writing back on
  // every keystroke would move the caret to the end of the node on each input event.
  createEffect((prevId: string | null | undefined) => {
    const id = selectedDocumentId();
    if (id !== prevId && richArea) richArea.innerHTML = richSeed();
    return id;
  }, null);

  function RichTextEditor() {
    return (
      <div class="rich-editor">
        <div class="format-toolbar" role="toolbar" aria-label="Rich text formatting">
          <For each={RICH_BUTTONS}>
            {(b) => (
              <button
                type="button"
                class="ghost small format-button"
                title={b.title}
                aria-label={b.title}
                // mousedown+preventDefault keeps the selection inside the editable.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  richArea?.focus();
                  document.execCommand(b.cmd, false, b.arg);
                  if (richArea) setEditBody(sanitizeRichHtml(richArea.innerHTML));
                }}
              >
                {b.label}
              </button>
            )}
          </For>
        </div>
        <div
          class="editor-body rich-editable"
          role="textbox"
          aria-multiline="true"
          aria-label="Rich text body"
          contentEditable
          ref={(el) => {
            richArea = el;
            el.innerHTML = richSeed();
          }}
          onInput={(e) => setEditBody(sanitizeRichHtml(e.currentTarget.innerHTML))}
          // Paste is the main injection route: force plain text, never foreign markup.
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData?.getData("text/plain") ?? "";
            document.execCommand("insertText", false, text);
            if (richArea) setEditBody(sanitizeRichHtml(richArea.innerHTML));
          }}
        />
      </div>
    );
  }

  function EditorSurface(props: { format: DocumentBodyFormat }) {
    return (
      <Show when={props.format === "rich-text"} fallback={
        <div class="plain-editor">
          <Show when={props.format === "text"}>
            <div class="format-toolbar" role="toolbar" aria-label="Markdown formatting">
              <For each={MD_BUTTONS}>
                {(b) => (
                  <button type="button" class="ghost small format-button" title={b.title} aria-label={b.title}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => runMarkdownCommand(b.cmd)}>
                    {b.label}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <textarea
            class="editor-body"
            ref={(el) => (bodyArea = el)}
            value={editBody()}
            onInput={(e) => setEditBody(e.currentTarget.value)}
            placeholder={props.format === "checklist" ? "One item per line…" : props.format === "code" ? "Code…" : "Markdown body…"}
          />
        </div>
      }>
        <RichTextEditor />
      </Show>
    );
  }


  return (
    <section class="documents-view">
      <Show when={error()}>
        <div class="error-bar" role="alert" onClick={() => setError(null)}>
          {error()}
        </div>
      </Show>

      {/* "Yours first" is a true statement about the personal container and a false
         one inside a project's Files & Links tab, where everything shown belongs to
         the project. The title is unchanged; only the subline tells the truth. */}
      {/* L1 (audit §3.1): identity is INHERITED, never asked again on a page. The
         shell owns the one "Acting as" control; this was the second one, and on the
         standalone route it was the last bare select left here. The acting profile
         is still switchable — in the shell — and this view follows it. */}
      <PageHeader title="Knowledge" subline={embedded() ? "Files and documents in this project" : "Yours first — what you wrote and starred"} />

      <nav class="container-tabs">
        {/* Every scope control below is wrapped, not disabled: see `embedded`. */}
        <Show when={!embedded()}>
        {/* THE SOURCE IS CHOSEN IN THE SHELL. My Documents, the organization's books
            and every project library are rows in the Knowledge sidebar now, so this
            page carries no picker of its own: one act, one place. */}

        <Show when={activeContainer() === "kb"}>
          <input placeholder="New book name" value={newBookName()} onInput={(e) => setNewBookName(e.currentTarget.value)} />
          <button class="ghost small" onClick={createBook} disabled={!newBookName().trim()}>
            + Book
          </button>
          <Show when={selectedBookId()}>
            <button class="ghost small" aria-expanded={showBookAccess()} onClick={() => setShowBookAccess((open) => !open)}>{showBookAccess() ? "hide book access" : "Book access"}</button>
            <input aria-label="Search this book" placeholder="Search this book…" value={bookQuery()} onInput={(e) => setBookQuery(e.currentTarget.value)} />
          </Show>
        </Show>

        </Show>

        {/* THE ACTS, ONE ROW, THE SAME ROW EVERYWHERE, ALWAYS REACHABLE. Upload and
            New document lead; New folder and Import library are quiet beside them in
            the same dress — they used to be two differently-styled leftovers at the
            foot of a column that no longer exists. They live in the page's action bar
            rather than in the empty canvas, so they stay available while a document
            is open, which is what the old tree column had been carrying them for. */}
        <div class="doc-actions documents-actionbar">
            <Show when={!isWeb()}>
              {/* Desktop: the native picker returns a real path, which is what
                  `upload_document_file` takes. No path is ever typed. */}
              <button class="primary doc-action-primary" onClick={pickAndUploadFile} disabled={uploading() || !projectReady()}>
                <span class="doc-action-icon" aria-hidden="true">↑</span>
                <span class="doc-action-copy"><strong>{uploading() ? "Uploading…" : "Upload file"}</strong><small>Choose a file from your computer</small></span>
              </button>
            </Show>
            <Show when={isWeb()}>
              {/* In the browser there is no path to name, so the same primary act
                  is a real file input wearing the same button. */}
              <label class="primary doc-action-primary doc-action-file">
                <span class="doc-action-icon" aria-hidden="true">↑</span>
                <span class="doc-action-copy"><strong>{uploading() ? "Uploading…" : "Upload file"}</strong><small>Choose a file or drop it here</small></span>
                <input
                  type="file"
                  aria-label="File to upload"
                  disabled={uploading() || !projectReady()}
                  onChange={(e) => {
                    const picked = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    if (picked) void uploadBrowserFile(picked);
                  }}
                />
              </label>
            </Show>
            {/* No `.ghost` here on purpose. `.theme-space-light button.ghost`
                strips fill and border, which made this read as plain text. This
                button is new, so no dark rule depends on `.ghost` for it, and
                `.doc-action-secondary` styles both themes on its own. */}
            <button class="doc-action-secondary" onClick={() => openCreate("document")} disabled={!projectReady()}>
              New document
            </button>
            {/* FOUR ACTS, FOUR BUTTONS, ONE RANK ORDER. Upload leads; the other three
                are equals and are dressed as equals — two of them used to be underlined
                text, which reads as a link into somewhere else, not as an act done here.
                Import is offered in EVERY library, including a project's: the command
                takes the container it is called from, so withholding it there was an
                arbitrary difference, not a rule. */}
            <button class="doc-action-secondary" onClick={() => openCreate("folder")} disabled={!projectReady()}>
              New folder
            </button>
            <button class="doc-action-secondary" onClick={() => setImportOpen((open) => !open)} aria-expanded={importOpen()}>
              {importOpen() ? "Close import" : "Import library"}
            </button>
            <Show when={importOpen()}>
                <div class="import-library-panel">
                  <p>Import a local Markdown or Confluence export.</p>
                  <input
                    aria-label="Import folder"
                    placeholder="Choose a folder to import"
                    value={importPath()}
                    onInput={(e) => setImportPath(e.currentTarget.value)}
                  />
                  <div class="import-library-actions">
                    <button class="doc-action-secondary" onClick={chooseImportFolder}>Choose folder</button>
                    <button class="primary" onClick={runImport} disabled={importing() || !importPath().trim() || !containerId() || !projectReady()}>
                      {importing() ? "Importing…" : "Import"}
                    </button>
                  </div>
                  <Show when={importSummary()}>
                    {(summary) => <span class="hint">{summary().documents_created} page(s), {summary().folders_created} folder(s)</span>}
                  </Show>
                </div>
            </Show>
        </div>

        {/* A filter, not a scope: it survives the embedded mount. */}
        <label class="show-archived">
          <input type="checkbox" checked={showArchived()} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
          show archived
        </label>
      </nav>

      {/* WHERE YOU ARE LIVES AT THE TOP, NOT IN THE MIDDLE. The path is the way out of
          a shelf — one click to any level above — and each crumb takes a drop, so
          moving something out is the same gesture as moving it in. */}
      <Show when={folderPath().length > 0}>
        <nav class="documents-breadcrumb" aria-label="Library path">
          <button
            class="documents-crumb documents-library-up"
            classList={{ "drop-into": dropTargetId() === "__root" }}
            title={`Back to ${containerName()} — or drop here to move an item out`}
            onClick={() => setSelectedFolderId(null)}
            onDragOver={(event) => {
              if (!isInternalDrag(event)) return;
              event.preventDefault();
              setDropTargetId("__root");
            }}
            onDragLeave={() => setDropTargetId((current) => (current === "__root" ? null : current))}
            onDrop={(event) => {
              const payload = event.dataTransfer?.getData("text/plain") ?? "";
              setDropTargetId(null);
              if (!payload) return;
              event.preventDefault();
              void fileInto(payload, null);
            }}
          >
            <span aria-hidden="true">←</span> {containerName()}
          </button>
          <For each={folderPath()}>
            {(folder, index) => (
              <>
                <span class="documents-crumb-sep" aria-hidden="true">/</span>
                <button
                  class="documents-crumb"
                  classList={{ current: index() === folderPath().length - 1, "drop-into": dropTargetId() === `__crumb:${folder.id}` }}
                  aria-current={index() === folderPath().length - 1 ? "true" : undefined}
                  onClick={() => setSelectedFolderId(folder.id)}
                  onDragOver={(event) => {
                    if (!isInternalDrag(event)) return;
                    event.preventDefault();
                    setDropTargetId(`__crumb:${folder.id}`);
                  }}
                  onDragLeave={() => setDropTargetId((current) => (current === `__crumb:${folder.id}` ? null : current))}
                  onDrop={(event) => {
                    const payload = event.dataTransfer?.getData("text/plain") ?? "";
                    setDropTargetId(null);
                    if (!payload) return;
                    event.preventDefault();
                    void fileInto(payload, folder.id);
                  }}
                >
                  {folder.name}
                </button>
              </>
            )}
          </For>
        </nav>
      </Show>

      <div class="documents-body">
        <section
          class="documents-editor"
          classList={{ "drop-target": dragOver() }}
          onDragOver={(event) => {
            if (!isWeb() || !event.dataTransfer?.types.includes("Files")) return;
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onTreeDrop}
        >
          <Show when={selectedDocument()} fallback={
            <div class="documents-empty-canvas" classList={{ "has-library": libraryFolders().length + libraryDocuments().length > 0 }}>
              <div class="documents-empty-card" classList={{ "has-library": libraryFolders().length + libraryDocuments().length > 0 }}>
                <Show when={dragOver()}>
                  <p class="drop-hint" role="status">Drop to upload into {selectedFolderId() ? "this folder" : "the root"}</p>
                </Show>
                <Show when={uploadProgress()}>
                  {(progress) => (
                    <div class="upload-progress">
                      <p class="hint">Uploading {progress().name}… {Math.round(progress().fraction * 100)}%</p>
                      <progress aria-label={`Upload progress for ${progress().name}`} max="1" value={progress().fraction} />
                    </div>
                  )}
                </Show>
                {/* Three states stay distinct: a fetch in flight is not emptiness, and a
                    failed fetch is never rendered as an empty library (H7). */}
                <Show when={!loadFailure()} fallback={<p class="error-bar" role="alert">{loadFailure()}</p>}>
                <Show when={!treeLoading()} fallback={<p class="hint pad" role="status">Loading…</p>}>
                <Show
                  when={containerId()}
                  fallback={<p class="hint pad">{activeContainer() === "kb" ? "Pick or create a book above." : "No personal container yet."}</p>}
                >
                {/* The library states itself once, at its own top-left, the way every
                    other page in the product does. Only a genuinely EMPTY library keeps
                    the centred card — there it is the whole content, not a header. */}
                <div class="documents-library-head">
                  <span class="documents-empty-icon" aria-hidden="true"><Icon name="books" size={26} /></span>
                  <div class="documents-library-headtext">
                    <h2>{libraryTitle()}</h2>
                    <p>
                      {libraryFolders().length + libraryDocuments().length
                        ? "Open a document, or drag it onto a shelf to file it."
                        : "This container has no folders or documents yet — upload a file or create a document to start."}
                    </p>
                  </div>
                </div>



                <Show when={activeContainer() === "kb" && bookQuery().trim()}>
    <div class="book-search-results" role="list" aria-label="Book search results">
    <Show when={!bookSearch.loading} fallback={<p class="hint">Searching…</p>}>
    <For each={bookSearch()}>{(hit) => <a role="listitem" class="doc-row" {...linkProps(docRoute(hit.id, "kb", selectedBookId()))} title={hit.snippet}><span class="doc-icon">⌕</span><span class="doc-title">{hit.title}</span></a>}</For>
    <Show when={(bookSearch() ?? []).length === 0}><p class="hint">No matching articles.</p></Show>
    </Show>
    </div>
    </Show>

                {/* Favourites head the personal tree: the documents you follow, wherever they
                    live, above the documents you own. Each row links into its own container,
                    so opening one lands in the project or book that owns it. */}
                <Show when={activeContainer() === "my-docs" && (favorites() ?? []).length > 0}>
                  <div class="favorites-section">
                    <p class="tree-heading">★ Favourites</p>
                    <For each={favoriteShelves()}>
                      {(shelf) => (
                        <div class="favorite-shelf">
                          <p class="shelf-name">{shelf.name ?? "Unfiled"}</p>
                          <ul
                            class="favorite-list"
                            role="list"
                            aria-label={shelf.name ? `Favourites on ${shelf.name}` : "Favourite documents"}
                          >
                            <For each={shelf.items}>
                              {(d, index) => (
                                <li
                                  class="favorite-row"
                                  draggable={true}
                                  onDragStart={(event) => event.dataTransfer?.setData("text/plain", `favorite:${d.id}`)}
                                >
                                  <a
                                    class="doc-row"
                                    classList={{ active: d.id === selectedDocumentId() }}
                                    {...linkProps(docRoute(d.id, d.container_type as ContainerType, d.container_id))}
                                  >
                                    <span class="doc-icon">{d.doc_type === "file" ? "📎" : "★"}</span>
                                    <span class="doc-title">{d.title}</span>
                                  </a>
                                  {/* Ordering is keyboard-operable, not drag-only: a list you
                                      can only sort with a mouse is a list some people cannot
                                      sort at all. */}
                                  <button
                                    class="ghost tiny"
                                    aria-label={`Move ${d.title} up`}
                                    disabled={index() === 0}
                                    onClick={() => void moveFavorite(d, -1)}
                                  >↑</button>
                                  <button
                                    class="ghost tiny"
                                    aria-label={`Move ${d.title} down`}
                                    disabled={index() === shelf.items.length - 1}
                                    onClick={() => void moveFavorite(d, 1)}
                                  >↓</button>
                                  <select
                                    class="shelf-picker"
                                    aria-label={`Shelf for ${d.title}`}
                                    value={d.group_name ?? ""}
                                    onChange={(event) => {
                                      const value = event.currentTarget.value;
                                      if (value === "__new") {
                                        setNewShelfFor(d.id);
                                        event.currentTarget.value = d.group_name ?? "";
                                        return;
                                      }
                                      void fileFavorite(d, value || null);
                                    }}
                                  >
                                    <option value="">Unfiled</option>
                                    <For each={favoriteGroups()}>{(name) => <option value={name}>{name}</option>}</For>
                                    <option value="__new">New shelf…</option>
                                  </select>
                                  <Show when={newShelfFor() === d.id}>
                                    <input
                                      class="shelf-new"
                                      aria-label={`New shelf name for ${d.title}`}
                                      placeholder="Shelf name…"
                                      autofocus
                                      onKeyDown={(event) => {
                                        if (event.key === "Escape") setNewShelfFor(null);
                                        if (event.key !== "Enter") return;
                                        const name = event.currentTarget.value.trim();
                                        setNewShelfFor(null);
                                        if (name) void fileFavorite(d, name);
                                      }}
                                    />
                                  </Show>
                                </li>
                              )}
                            </For>
                          </ul>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={libraryFolders().length + libraryDocuments().length > 0}>
                  <div class="documents-library">
                    {/* SHELVES FIRST, SIDE BY SIDE. Each one takes what you drag onto it. */}
                    <Show when={libraryFolders().length > 0}>
                      <p class="documents-library-heading">Shelves</p>
                      <div class="documents-shelf-grid" aria-label={`${libraryTitle()} shelves`}>
                        <For each={libraryFolders()}>
                          {(folder) => (
                            <div
                              class="documents-shelf folder-row"
                              classList={{ archived: folder.archived, "drop-into": dropTargetId() === folder.id }}
                              draggable={renamingFolderId() !== folder.id}
                              onDragStart={(event) => event.dataTransfer?.setData("text/plain", `folder:${folder.id}`)}
                              onDragOver={(event) => {
                                if (!isInternalDrag(event)) return;
                                event.preventDefault();
                                event.stopPropagation();
                                setDropTargetId(folder.id);
                              }}
                              onDragLeave={() => setDropTargetId((current) => (current === folder.id ? null : current))}
                              onDrop={(event) => {
                                const payload = event.dataTransfer?.getData("text/plain") ?? "";
                                setDropTargetId(null);
                                if (!payload) return;
                                event.preventDefault();
                                event.stopPropagation();
                                void fileInto(payload, folder.id);
                              }}
                            >
                              <Show
                                when={renamingFolderId() === folder.id}
                                fallback={
                                  <button class="documents-shelf-open folder-name" onClick={() => setSelectedFolderId(folder.id)}>
                                    <span class="documents-shelf-icon" aria-hidden="true"><Icon name="folder" size={20} /></span>
                                    <span class="documents-library-card-copy">
                                      <strong>{folder.name}</strong>
                                      <small>{shelfSubline(folder.id)}</small>
                                    </span>
                                  </button>
                                }
                              >
                                <input
                                  class="folder-rename-input"
                                  value={renameValue()}
                                  onInput={(e) => setRenameValue(e.currentTarget.value)}
                                  onKeyDown={(e) => e.key === "Enter" && saveRenameFolder(folder)}
                                />
                                <button class="ghost small" onClick={() => saveRenameFolder(folder)}>✓</button>
                              </Show>
                              {/* Shelf upkeep stays reachable but quiet: on hover or focus only. */}
                              {/* MOVING IS DRAGGING. The shelf is grabbable and takes drops,
                                  so the old "move…" dropdown was a second way to do the same
                                  act — and the uglier one, hanging out of the tile on hover.
                                  What is left is what a drag cannot say: a new name, and
                                  putting the shelf away. */}
                              <span class="folder-actions">
                                <button class="shelf-action" title="Rename" aria-label={`Rename ${folder.name}`} onClick={() => startRenameFolder(folder)}>
                                  <Icon name="edit" size={14} />
                                </button>
                                <button
                                  class="shelf-action"
                                  title={folder.archived ? "Restore" : "Archive"}
                                  aria-label={`${folder.archived ? "Restore" : "Archive"} ${folder.name}`}
                                  onClick={() => toggleFolderArchived(folder)}
                                >
                                  <Icon name={folder.archived ? "enter" : "close"} size={14} />
                                </button>
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    <Show when={libraryDocuments().length > 0}>
                      <p class="documents-library-heading">Documents</p>
                      <div class="documents-library-grid" aria-label={`${libraryTitle()} library`}>
                        <For each={libraryDocuments()}>
                          {(document) => (
                            <a
                              class="documents-library-card"
                              classList={{ archived: document.archived }}
                              draggable={true}
                              onDragStart={(event) => event.dataTransfer?.setData("text/plain", `document:${document.id}`)}
                              {...linkProps(docRoute(document.id))}
                            >
                              <span class="documents-library-type" aria-hidden="true">
                                <Icon name={document.doc_type === "file" ? "upload" : "doc"} size={16} />
                              </span>
                              <span class="documents-library-card-copy"><strong>{document.title}</strong><small>{document.doc_type === "file" ? "Uploaded file" : "Document"} · v{document.version}</small></span>
                              <span class="documents-library-open" aria-hidden="true">→</span>
                            </a>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>
                {/* Inside a project the wider organization library is one click away; on
                    the standalone route the sidebar already lists every library. */}
                <Show when={embedded()}>
                  <a class="documents-library-link" {...linkProps(books().length ? { view: "Documents", containerType: "kb", containerId: books()[0].id } : { view: "Documents" })}>
                    Open organization library <span aria-hidden="true">→</span>
                  </a>
                </Show>
                </Show>
                </Show>
                </Show>
              </div>
            </div>
          }>
            {(doc) => (
              <>
                <div class="editor-toolbar">
                  <input class="editor-title" value={editTitle()} onInput={(e) => setEditTitle(e.currentTarget.value)} />
                  <span class="version-chip">v{doc().version}</span>
                  <button
                    class="ghost small favorite-toggle"
                    aria-label={isFavorite(doc().id) ? "Remove from My Documents favourites" : "Add to My Documents favourites"}
                    aria-pressed={isFavorite(doc().id)}
                    onClick={() => void toggleFavorite(doc().id)}
                  >
                    {isFavorite(doc().id) ? "★ Favourite" : "☆ Favourite"}
                  </button>
<select aria-label="Document body type" value={doc().body_format} onChange={(e) => void changeBodyFormat(doc(), e.currentTarget.value as DocumentBodyFormat)}>
<option value="text">Text / Markdown</option><option value="rich-text">Rich text</option><option value="checklist">Checklist</option><option value="code">Code</option>
</select>
                  <Show when={doc().archived}>
                    <span class="archived-chip">archived</span>
                  </Show>
                  <button class="ghost small" onClick={() => setShowPreview((v) => !v)}>
                    {showPreview() ? "hide preview" : "show preview"}
                  </button>
                  <select value={doc().folder_id ?? ""} onChange={(e) => moveDocumentTo(e.currentTarget.value)}>
                    <option value={activeContainer() === "project" ? rootParentId() ?? "" : ""}>{activeContainer() === "project" ? "Documents" : "(root)"}</option>
                    <For each={displayFolders()}>{(f) => <option value={f.id}>{f.name}</option>}</For>
                  </select>
                  <button class="ghost small" onClick={toggleArchiveDocument}>
                    {doc().archived ? "unarchive" : "archive"}
                  </button>
                  <Show when={canManageAccess()}>
                    <button class="ghost small" aria-expanded={showSharing()} onClick={() => setShowSharing((open) => !open)}>
                      {showSharing() ? "hide sharing" : "Share"}
                    </button>
                  </Show>
                  <Show when={publication()}>
                    {(pub) => (
                      <>
                        <button class="ghost small" onClick={togglePublished}>
                          {pub().published ? "unpublish" : "publish"}
                        </button>
                        <Show when={pub().published && pub().public_slug}>
                          <span class="public-link" title="public link path">/public/{pub().public_slug}</span>
                        </Show>
                      </>
                    )}
                  </Show>
                  <Show when={canPublishToBlog()}>
                    <Show when={blogArticle()} fallback={
                      <button class="ghost small" onClick={publishDraftToBlog} title="Publish this draft as a blog article">
                        Publish to Blog
                      </button>
                    }>
                      {(post) => (
                        <>
                          <span class="blog-chip" classList={{ archived: post().archived }}>
                            {post().archived ? "blog: archived" : "blog article"}
                          </span>
                          <button class="ghost small" onClick={() => setBlogArchived(post(), !post().archived)}>
                            {post().archived ? "restore article" : "unpublish"}
                          </button>
                        </>
                      )}
                    </Show>
                  </Show>
                  <button class="primary" onClick={saveDocument}>
                    Save version
                  </button>
                </div>

                <Show when={doc().doc_type === "file"} fallback={
                  <div class="editor-panes" classList={{ split: showPreview() }}>
                    <EditorSurface format={doc().body_format} />
                    <Show when={showPreview()}>
                      <div class="editor-preview"><DocumentRenderer format={() => doc().body_format} /></div>
                    </Show>
                  </div>
                }>
                  <div class="editor-panes">
                    <Show when={filePreview()} fallback={<p class="hint pad">{filePreview.loading ? "Loading file…" : "Uploaded file unavailable."}</p>}>
                      {(preview) => <FilePreview preview={preview()} />}
                    </Show>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </section>

        <Show when={selectedDocument() || (activeContainer() === "kb" && showBookAccess())}>
          <aside class="documents-history">
            <Show when={activeContainer() === "kb" && showBookAccess()}>
              <section class="document-sharing" aria-label="Book access">
                <div class="sharing-head"><div class="section-label">Book access</div><span class="sharing-note">People and editor teams</span></div>
                <div class="sharing-add">
                  <select value={shareRecipientType()} onChange={(e) => { setShareRecipientType(e.currentTarget.value as "profile" | "team"); setShareRecipientId(""); }}><option value="profile">Person</option><option value="team">Team</option></select>
                  <select value={shareRecipientId()} onChange={(e) => setShareRecipientId(e.currentTarget.value)}><option value="">Select recipient…</option><Show when={shareRecipientType() === "profile"}><For each={profiles()?.filter((p) => !p.archived && p.id !== actingProfileId())}>{(p) => <option value={p.id}>{p.display_name}</option>}</For></Show><Show when={shareRecipientType() === "team"}><For each={teams()?.filter((t) => !t.archived)}>{(t) => <option value={t.id}>{t.name}</option>}</For></Show></select>
                  <select value={shareAccessLevel()} onChange={(e) => setShareAccessLevel(e.currentTarget.value as "viewer" | "editor")}><option value="viewer">Viewer</option><option value="editor">Editor</option></select>
                  <button class="primary small" disabled={!shareRecipientId()} onClick={addBookAccessRecipient}>Add</button>
                </div>
                <ul class="sharing-list"><For each={bookAccess()}>{(permission) => <li><span class="sharing-recipient">{recipientName(permission)}</span><span class="sharing-kind">{permission.recipient_type}</span><span class="sharing-level">{permission.access_level}</span><button class="ghost small" onClick={() => removeBookAccessRecipient(permission)}>Remove</button></li>}</For></ul>
              </section>
            </Show>
            <CommentPanel />
            <Show when={canManageAccess() && showSharing()}>
              <section class="document-sharing" aria-label="Document sharing">
                <div class="sharing-head">
                  <div class="section-label">Share document</div>
                  <span class="sharing-note">Private document access</span>
                </div>
                <p class="hint">Invite people or teams as viewers or editors. Project documents inherit project access.</p>
                <div class="sharing-add">
                  <select value={shareRecipientType()} onChange={(e) => { setShareRecipientType(e.currentTarget.value as "profile" | "team"); setShareRecipientId(""); }}>
                    <option value="profile">Person</option>
                    <option value="team">Team</option>
                  </select>
                  <select value={shareRecipientId()} onChange={(e) => setShareRecipientId(e.currentTarget.value)}>
                    <option value="">Select {shareRecipientType() === "profile" ? "person" : "team"}…</option>
                    <Show when={shareRecipientType() === "profile"}>
                      <For each={profiles()?.filter((p) => !p.archived && p.id !== actingProfileId())}>
                        {(p) => <option value={p.id}>{p.display_name}</option>}
                      </For>
                    </Show>
                    <Show when={shareRecipientType() === "team"}>
                      <For each={teams()?.filter((t) => !t.archived)}>
                        {(t) => <option value={t.id}>{t.name}</option>}
                      </For>
                    </Show>
                  </select>
                  <select value={shareAccessLevel()} onChange={(e) => setShareAccessLevel(e.currentTarget.value as "viewer" | "editor")}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <button class="primary small" disabled={!shareRecipientId()} onClick={addAccessRecipient}>Add</button>
                </div>
                <Show when={!access.loading} fallback={<p class="hint">Loading access…</p>}>
                  <ul class="sharing-list">
                    <For each={access()}>
                      {(permission) => (
                        <li>
                          <span class="sharing-recipient">{recipientName(permission)}</span>
                          <span class="sharing-kind">{permission.recipient_type === "profile" ? "person" : "team"}</span>
                          <span class="sharing-level">{permission.access_level}</span>
                          <button class="ghost small" aria-label={`Remove ${recipientName(permission)}`} onClick={() => removeAccessRecipient(permission)}>Remove</button>
                        </li>
                      )}
                    </For>
                  </ul>
                  <Show when={(access() ?? []).length === 0}>
                    <p class="hint">Only you can access this document.</p>
                  </Show>
                </Show>
              </section>
            </Show>
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

      <Show when={createMode()}>
        {(mode) => (
          <DocumentCreateDrawer
            mode={mode()}
            scopeLabel={createScopeLabel()}
            name={mode() === "document" ? newDocTitle() : newFolderName()}
            setName={mode() === "document" ? setNewDocTitle : setNewFolderName}
            bodyFormat={newDocBodyFormat()}
            setBodyFormat={setNewDocBodyFormat}
            busy={creating()}
            onSubmit={() => void submitCreate()}
            onClose={() => setCreateMode(null)}
          />
        )}
      </Show>
    </section>
  );
}
