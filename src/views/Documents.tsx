import { createResource, createSignal, createEffect, For, Show } from "solid-js";
import { marked } from "marked";
import "../App.css";
import "./Documents.css";
import { Resizer, paneWidth } from "../components/Resizer";
import { useDeepLink, linkContainer, linkEntity, linkProps, route } from "../router";
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
} from "../api/documents";
import { chatApi, newId as newMessageId, type MessageView } from "../api/chat";
import { channelFeedsApi } from "../api/channel-feeds";
import { profileId as sessionProfileId, profileLocked } from "../session";
import { applyMarkdownCommand, sanitizeRichHtml, type MarkdownCommand } from "../richtext";
import { blogsApi, type BlogPost } from "../api/blogs";

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
    if (list && list.length && !localProfileId()) setLocalProfileId(list[0].id);
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
  const rootParentId = () => (activeContainer() === "kb" ? selectedBookId() : null);

  const [allFolders, { refetch: refetchFolders }] = createResource(() => documentsApi.listDocumentFolders());
  const [allDocuments, { refetch: refetchDocuments }] = createResource(() => documentsApi.listDocuments());

  const books = () => (allFolders() ?? []).filter((f) => f.container_type === "kb" && f.parent_id === null);
  createEffect(() => {
    if (activeContainer() === "kb" && !selectedBookId() && books().length) setSelectedBookId(books()[0].id);
  });

  const [showArchived, setShowArchived] = createSignal(false);

  const treeLoading = () => allFolders.loading || allDocuments.loading;
  const loadFailure = () => {
    const e = allFolders.error ?? allDocuments.error;
    return e ? `Documents could not be loaded: ${String(e)}` : null;
  };
  const isEmpty = () => !treeLoading() && !loadFailure() && scopedFolders().length === 0 && scopedDocuments().length === 0;

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

  // ---- import (Confluence export / local notes folder) ----
  // Both are the same shape on disk; the Rust side mirrors the directory tree into folders.
  const [importPath, setImportPath] = createSignal("");
  const [importing, setImporting] = createSignal(false);
  const [importSummary, setImportSummary] = createSignal<DocumentImportSummary | null>(null);
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
      await Promise.all([refetchFolders(), refetchDocuments()]);
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
  const containerRoute = (container:ContainerType) => ({
    view: "Documents", containerType: container,
    containerId: (container === "my-docs" ? actingProfileId() : container === "project" ? selectedProjectId() : selectedBookId()) ?? undefined,
  });
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
        folder_id: selectedFolderId(),
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
  const [filePreview] = createResource(
    () => (selectedDocument()?.doc_type === "file" ? selectedDocumentId() : null),
    (id) => (id ? documentsApi.readDocumentFile(id) : Promise.resolve(null)),
  );
  const previewDataUrl = (p: DocumentFilePreview) =>
    p.data_base64 ? `data:${p.mime};base64,${p.data_base64}` : "";
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
        <Show when={p().text === null && !p().mime.startsWith("image/")}>
          <p class="hint">No inline preview for this type — the file is stored and downloadable from disk.</p>
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

  function FolderRow(props: { folder: DocumentFolder; depth: number }) {
    const f = () => props.folder;
    const childFolders = () => scopedFolders().filter((c) => c.parent_id === f().id);
    const childDocs = () => scopedDocuments().filter((d) => d.folder_id === f().id);
    const isOpen = () => expanded().has(f().id);
    return (
      <>
        <li
          class="folder-row"
          role="treeitem"
          aria-expanded={isOpen()}
          aria-selected={selectedFolderId() === f().id}
          style={{ "padding-left": `${props.depth * 1.1 + 0.4}em` }}
        >
          {/* A real button: Enter/Space expand the folder with no key handler of our own. */}
          <button
            type="button"
            class="folder-toggle"
            aria-expanded={isOpen()}
            aria-label={`${isOpen() ? "Collapse" : "Expand"} ${f().name}`}
            onClick={() => toggleExpand(f().id)}
          >
            {isOpen() ? "▾" : "▸"}
          </button>
          <Show
            when={renamingFolderId() === f().id}
            fallback={
              <button
                type="button"
                class="folder-name"
                classList={{ active: selectedFolderId() === f().id, archived: f().archived }}
                onClick={() => setSelectedFolderId(f().id)}
              >
                {f().name}
              </button>
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
        <div class="error-bar" role="alert" onClick={() => setError(null)}>
          {error()}
        </div>
      </Show>

      <header class="documents-head">
        <div>
          <h1>Documents</h1>
          <p>My Documents, project docs, and the Knowledge Base share one folder/document/version model.</p>
        </div>
        <Show when={!profileLocked()}>
        <label>
          Acting as
          <select value={actingProfileId() ?? ""} onChange={(e) => {
            const id = e.currentTarget.value || null;
            setActingProfileId(id);
            if (activeContainer() === "my-docs") linkContainer("my-docs", id ?? undefined);
          }}>
            <For each={profiles()?.filter((p) => !p.archived)}>{(p) => <option value={p.id}>{p.display_name}</option>}</For>
          </select>
        </label>
        </Show>
      </header>

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

        <label class="import-folder">
          Import folder
          <input
            placeholder="path to a markdown / Confluence-export folder"
            value={importPath()}
            onInput={(e) => setImportPath(e.currentTarget.value)}
          />
        </label>
        <button class="ghost small" onClick={runImport} disabled={importing() || !importPath().trim() || !containerId()}>
          {importing() ? "Importing…" : "Import"}
        </button>
        <Show when={importSummary()}>
          {(summary) => (
            <span class="hint import-summary">
              {summary().documents_created} page(s), {summary().folders_created} folder(s)
              {summary().skipped.length ? ` · skipped ${summary().skipped.length}: ${summary().skipped.join("; ")}` : ""}
            </span>
          )}
        </Show>

        <label class="show-archived">
          <input type="checkbox" checked={showArchived()} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
          show archived
        </label>
      </nav>

      <div class="documents-body" style={{ "--col-tree": treeW() + "px" }}>
        <aside class="documents-tree">
          {/* Three states stay distinct: a fetch in flight is not emptiness, and a failed
              fetch is never rendered as an empty tree (H7). */}
          <Show when={!loadFailure()} fallback={<p class="error-bar" role="alert">{loadFailure()}</p>}>
          <Show when={!treeLoading()} fallback={<p class="hint pad" role="status">Loading…</p>}>
          <Show
            when={containerId()}
            fallback={<p class="hint pad">{activeContainer() === "kb" ? "Pick or create a book above." : "No personal container yet."}</p>}
          >
            <button
              type="button"
              class="tree-root"
              classList={{ active: selectedFolderId() === null }}
              onClick={() => setSelectedFolderId(null)}
            >
              (root)
            </button>
            <ul class="folder-tree" role="tree" aria-label="Document folders">
              <For each={scopedDocuments().filter((d) => d.folder_id === rootParentId())}>
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
            <Show when={isEmpty()}>
              <p class="empty-state">This container has no folders or documents yet.</p>
            </Show>
            <div class="new-item-forms">
              <div class="new-item-row">
                <input placeholder="New folder name" value={newFolderName()} onInput={(e) => setNewFolderName(e.currentTarget.value)} />
                <button class="ghost small" onClick={createFolder} disabled={!newFolderName().trim()}>
                  + Folder
                </button>
              </div>
              <div class="new-item-row">
                <input placeholder="New document title" value={newDocTitle()} onInput={(e) => setNewDocTitle(e.currentTarget.value)} />
                <select aria-label="Document body type" value={newDocBodyFormat()} onChange={(e) => setNewDocBodyFormat(e.currentTarget.value as DocumentBodyFormat)}>
                  <option value="text">Text / Markdown</option><option value="rich-text">Rich text</option><option value="checklist">Checklist</option><option value="code">Code</option>
                </select>
                <button class="primary small" onClick={createDocument} disabled={!newDocTitle().trim()}>
                  + Document
                </button>
              </div>
              <div class="new-item-row">
                <input
                  placeholder="path to a file to upload"
                  aria-label="File to upload"
                  value={uploadPath()}
                  onInput={(e) => setUploadPath(e.currentTarget.value)}
                />
                <button class="ghost small" onClick={uploadFile} disabled={uploading() || !uploadPath().trim()}>
                  {uploading() ? "Uploading…" : "↑ Upload"}
                </button>
              </div>
              <p class="hint">
                Creating into: {selectedFolderId() ? scopedFolders().find((f) => f.id === selectedFolderId())?.name ?? "(root)" : "(root)"}
              </p>
            </div>
          </Show>
          </Show>
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
                    <option value="">(root)</option>
                    <For each={scopedFolders()}>{(f) => <option value={f.id}>{f.name}</option>}</For>
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

        <Show when={selectedDocument()}>
          <aside class="documents-history">
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
    </section>
  );
}
