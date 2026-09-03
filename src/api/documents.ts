// Documents / Knowledge Base API surface — thin invoke() wrappers over
// src-tauri/src/documents.rs. Kept standalone from ../api.ts (owned by another lane):
// types + calls needed by views/Documents.tsx + views/Documents.css only.
import { invoke } from "@tauri-apps/api/core";
import { newId as rawId } from "./ids";

export function newId(prefix: string): string {
  return `${prefix}-${rawId()}`;
}

// "my-docs"  -> container_id = owning profile id (personal, private tree)
// "project"  -> container_id = project id
// "kb"       -> container_id = book id — a book is the top-level (parent_id null)
//               folder in the 'kb' container; articles are documents filed under it.
export type ContainerType = "my-docs" | "project" | "kb";

export type DocumentFolder = {
  id: string;
  container_type: string;
  container_id: string | null;
  parent_id: string | null;
  name: string;
  description: string | null;
  archived: boolean;
};

export type DocType = "text" | "file";

/// A favourite is a document plus the two facts that belong to the pointer alone.
export type FavoriteDocument = Document & {
  group_name: string | null;
  position: number;
};
export type DocumentBodyFormat = "text" | "rich-text" | "checklist" | "code";

/** What a document IS, not how its text is styled: prose or a grid.
 *  Older rows carry no kind at all and read back as "markdown" (see documents.rs). */
export type DocKind = "markdown" | "sheet" | "budget";

/** The single question the create form asks: prose in one of its flavours, or a table. */
export type DocumentCreateType = DocumentBodyFormat | "sheet" | "budget";

export type SheetColumnType = "text" | "number" | "date";
export type SheetColumn = { id: string; label: string; type: SheetColumnType };
export type SheetRow = { id: string; cells: Record<string, string> };
/** The body of a `sheet` document, verbatim as it is stored (JSON string in `body`).
 *  Ids are stable and never reused, so two versions diff cell by cell. */
export type SheetDoc = { columns: SheetColumn[]; rows: SheetRow[] };

export const newColumnId = () => newId("c");
export const newRowId = () => newId("r");

/** A sheet nobody has filled in yet: three named columns, three empty rows —
 *  enough to type into, never an empty statement on the page. */
export function emptySheet(): SheetDoc {
  const columns: SheetColumn[] = [
    { id: newColumnId(), label: "Column 1", type: "text" },
    { id: newColumnId(), label: "Column 2", type: "text" },
    { id: newColumnId(), label: "Column 3", type: "text" },
  ];
  const rows: SheetRow[] = [0, 1, 2].map(() => ({ id: newRowId(), cells: {} }));
  return { columns, rows };
}

const COLUMN_TYPES: SheetColumnType[] = ["text", "number", "date"];

/** Tolerant on the way in: an unreadable or empty body opens a usable grid rather than
 *  an error page. Strictness lives on the write path, where the server refuses garbage. */
export function parseSheet(body: string | null | undefined): SheetDoc {
  if (!body || !body.trim()) return emptySheet();
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return emptySheet();
  }
  if (!raw || typeof raw !== "object") return emptySheet();
  const source = raw as { columns?: unknown; rows?: unknown };
  const columns: SheetColumn[] = Array.isArray(source.columns)
    ? source.columns.flatMap((entry) => {
        const column = entry as Partial<SheetColumn>;
        if (!column || typeof column.id !== "string" || !column.id.trim()) return [];
        const type = COLUMN_TYPES.includes(column.type as SheetColumnType) ? (column.type as SheetColumnType) : "text";
        return [{ id: column.id, label: typeof column.label === "string" ? column.label : "", type }];
      })
    : [];
  if (!columns.length) return emptySheet();
  const known = new Set(columns.map((column) => column.id));
  const rows: SheetRow[] = Array.isArray(source.rows)
    ? source.rows.flatMap((entry) => {
        const row = entry as Partial<SheetRow>;
        if (!row || typeof row.id !== "string" || !row.id.trim()) return [];
        const cells: Record<string, string> = {};
        for (const [columnId, value] of Object.entries(row.cells ?? {})) {
          if (known.has(columnId) && typeof value === "string") cells[columnId] = value;
        }
        return [{ id: row.id, cells }];
      })
    : [];
  return { columns, rows };
}

/** WHAT A TABLE LOOKS LIKE IN A LIST. A version list is a list of *changes a person
 *  made*, so it must speak about the table — "3 columns × 3 rows · Vendor, Amount" —
 *  never about its JSON. Unlike `parseSheet` this one is STRICT on purpose: a body it
 *  cannot read must not be dressed up as an empty grid, it is simply "Table".
 *  It never throws: a broken version may not take the whole history down with it. */
export function sheetSnippet(body: string | null | undefined): string {
  let raw: unknown;
  try {
    raw = JSON.parse((body ?? "").trim() || "null");
  } catch {
    return "Table";
  }
  if (!raw || typeof raw !== "object") return "Table";
  const source = raw as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(source.columns)) return "Table";
  const labels = source.columns.flatMap((entry) => {
    const column = entry as Partial<SheetColumn> | null;
    if (!column || typeof column !== "object" || typeof column.id !== "string" || !column.id.trim()) return [];
    const label = typeof column.label === "string" ? column.label.trim() : "";
    return [label || "Column"];
  });
  if (!labels.length) return "Table";
  const rows = Array.isArray(source.rows) ? source.rows.length : 0;
  const named = labels.slice(0, 4).join(", ") + (labels.length > 4 ? ", …" : "");
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `${plural(labels.length, "column")} × ${plural(rows, "row")} · ${named}`;
}

/** The one place a stored body becomes a line of history — prose keeps its old text
 *  preview, a table gets counted and named. */
export function versionSnippet(kind: string | null | undefined, body: string | null | undefined): string {
  if (kind === "sheet") return sheetSnippet(body);
  return (body ?? "").slice(0, 80) || "(empty)";
}

/** Exactly the shape `documents.rs` validates — no extra keys, no undefined cells. */
export function serializeSheet(sheet: SheetDoc): string {
  return JSON.stringify({
    columns: sheet.columns.map((column) => ({ id: column.id, label: column.label, type: column.type })),
    rows: sheet.rows.map((row) => ({
      id: row.id,
      cells: Object.fromEntries(
        sheet.columns
          .filter((column) => (row.cells[column.id] ?? "") !== "")
          .map((column) => [column.id, row.cells[column.id]]),
      ),
    })),
  });
}

export type Document = {
  id: string;
  container_type: string;
  container_id: string | null;
  folder_id: string | null;
  doc_type: DocType;
  body_format: DocumentBodyFormat;
  /** Absent on documents written by callers that predate sheets; the server reads
   *  those back as "markdown", so treat a missing kind as prose. */
  kind?: DocKind;
  title: string;
  body: string | null;
  version: number;
  archived: boolean;
  created_by: string | null;
};

export type DocumentDiscussion = { document_id:string; channel_id:string; meeting_id:string|null };
export type DocVersion = {
  id: string;
  document_id: string;
  version: number;
  body: string | null;
  created_by: string | null;
  created_at: number;
};

export type DocumentSearchResult = {
id: string;
title: string;
snippet: string;
};
export type DocumentAccessRecipient = {
  recipient_type: "profile" | "team";
  recipient_id: string;
  access_level: "viewer" | "editor";
};

// Import defaults live in Rust (documents.rs); omit a field to accept its default.
export type DocumentImportRequest = {
  source_path: string;
  container_type: ContainerType;
  container_id: string | null;
  parent_folder_id: string | null;
  created_by: string | null;
  extensions?: string[];
  max_file_bytes?: number;
  max_depth?: number;
};

export type DocumentImportSummary = {
  folders_created: number;
  documents_created: number;
  skipped: string[];
};

export type DocumentPublication = {
  document_id: string;
  published: boolean;
  published_at: number | null;
  public_slug: string | null;
};

// Uploaded files: the payload lives beside the database, the row carries metadata only.
// Like the folder importer, uploading names a path on the *backend* filesystem, so the
// command is desktop-only; the web transport does not expose it.
export type DocumentFile = {
  document_id: string;
  filename: string;
  mime: string;
  size: number;
  uploaded_by: string | null;
  uploaded_at: number;
};

export type UploadDocumentFileRequest = {
  source_path: string;
  container_type: ContainerType;
  container_id: string | null;
  folder_id: string | null;
  title?: string | null;
  created_by?: string | null;
  max_file_bytes?: number;
};

export type WebDocumentUpload = {
  container_type: ContainerType;
  container_id: string | null;
  folder_id: string | null;
  title?: string | null;
};

export type DocumentFilePreview = {
  document_id: string;
  filename: string;
  mime: string;
  size: number;
  truncated: boolean;
  text: string | null;
  data_base64: string | null;
};

export const ORGANIZATION_LIBRARY_ID = "organization-library";
export const documentsApi = {
  // documents
  ensureOrganizationLibraryRoot: () => invoke<DocumentFolder>("ensure_organization_library_root"),
  ensureProjectDocumentRoot: (projectId: string) => invoke<DocumentFolder>("ensure_project_document_root", { projectId }),
  listDocuments: () => invoke<Document[]>("list_documents"),
  getDocument: (id: string) => invoke<Document | null>("get_document", { id }),
getDocumentDiscussion: (documentId: string) => invoke<DocumentDiscussion | null>("get_document_discussion", { documentId }),
attachDocumentDiscussion: (documentId: string, meetingId: string | null = null) => invoke<DocumentDiscussion>("attach_document_discussion", { documentId, meetingId }),
  createDocument: (document: Document) => invoke<void>("create_document", { document }),
  updateDocument: (document: Document) => invoke<void>("update_document", { document }),
  moveDocument: (id: string, containerType: string, containerId: string | null, folderId: string | null) =>
    invoke<void>("move_document", { id, containerType, containerId, folderId }),
  archiveDocument: (id: string, archived: boolean) => invoke<void>("archive_document", { id, archived }),
  /** Gone means gone: the row and every version of it. The backend re-checks the
   *  owner rule; `actorId` is overwritten with the session identity on the server,
   *  so nobody deletes under another name. Always ask first (ConfirmDialog). */
  deleteDocument: (id: string, actorId: string) => invoke<void>("delete_document", { id, actorId }),
  /** Refuses a folder that still holds anything — nothing is deleted implicitly. */
  deleteDocumentFolder: (id: string, actorId: string) => invoke<void>("delete_document_folder", { id, actorId }),
  saveDocument: (id: string, title: string, body: string | null, actor: string | null) =>
    invoke<Document>("save_document", { id, title, body, actor }),
  listDocVersions: (documentId: string) => invoke<DocVersion[]>("list_doc_versions", { documentId }),
  restoreDocVersion: (documentId: string, version: number, actor: string | null) =>
    invoke<Document>("restore_doc_version", { documentId, version, actor }),
  listDocumentAccess: (documentId: string) =>
    invoke<DocumentAccessRecipient[]>("list_document_access", { documentId }),
  updateDocumentAccess: (documentId: string, permissions: DocumentAccessRecipient[]) =>
    invoke<void>("update_document_access", { documentId, permissions: permissions.map(({ recipient_id, ...permission }) => ({ ...permission, member_id: recipient_id })) }),

  // publication (public links) — unpublishing keeps the slug so the link can be reopened.
  getPublication: (documentId: string) =>
    invoke<DocumentPublication>("get_document_publication", { documentId }),
  publishDocument: (documentId: string, published: boolean, slug: string | null = null) =>
    invoke<DocumentPublication>("publish_document", { documentId, published, slug }),
  getPublicDocument: (slug: string) => invoke<Document | null>("get_public_document", { slug }),
  /** The owners of a book: only they may end it, and the surface must be able to
   *  say so before somebody clicks. */
  listBookOwners: (bookId: string) => invoke<string[]>("list_book_owners", { bookId }),
  listBookAccess: (bookId: string) =>
    invoke<DocumentAccessRecipient[]>("list_book_access", { bookId }),
  updateBookAccess: (bookId: string, permissions: DocumentAccessRecipient[]) =>
    invoke<void>("update_book_access", { bookId, permissions: permissions.map(({ recipient_id, ...permission }) => ({ ...permission, member_id: recipient_id })) }),
  searchBookDocuments: (bookId: string, query: string) =>
    invoke<DocumentSearchResult[]>("search_book_documents", { bookId, query }),

  // Favourites: a pointer from a person to a document that lives elsewhere, carrying
  // the shelf it was filed on and where it sits on that shelf.
  listFavorites: (profileId: string) =>
    invoke<FavoriteDocument[]>("list_favorite_documents", { profileId }),
  setFavorite: (profileId: string, documentId: string, favorite: boolean) =>
    invoke<void>("set_document_favorite", { profileId, documentId, favorite }),
  moveFavorite: (profileId: string, documentId: string, groupName: string | null, position: number) =>
    invoke<void>("move_favorite_document", { profileId, documentId, groupName, position }),

  // Upload with progress: `fetch` cannot report how far a body has been sent, so the
  // one place that needs a progress bar uses XHR. Same route, same reply shape.
  uploadWebFileWithProgress: (
    file: File,
    request: WebDocumentUpload,
    onProgress: (fraction: number) => void,
  ): Promise<DocumentFile> =>
    new Promise((resolve, reject) => {
      const base = import.meta.env.BASE_URL;
      const query = new URLSearchParams({
        filename: file.name,
        container_type: request.container_type,
        ...(request.container_id ? { container_id: request.container_id } : {}),
        ...(request.folder_id ? { folder_id: request.folder_id } : {}),
        ...(request.title ? { title: request.title } : {}),
      });
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${base}api/documents/upload?${query}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText) as { ok: boolean; value?: DocumentFile; error?: string };
          if (!body.ok || !body.value) reject(new Error(body.error ?? `upload failed (HTTP ${xhr.status})`));
          else resolve(body.value);
        } catch {
          reject(new Error(`upload failed (HTTP ${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("upload failed: network error"));
      xhr.send(file);
    }),

  uploadFile: (request: UploadDocumentFileRequest) =>
    invoke<DocumentFile>("upload_document_file", { request }),
  uploadWebFile: async (file: File, request: WebDocumentUpload): Promise<DocumentFile> => {
    const base = import.meta.env.BASE_URL;
    const query = new URLSearchParams({
      filename: file.name,
      container_type: request.container_type,
      ...(request.container_id ? { container_id: request.container_id } : {}),
      ...(request.folder_id ? { folder_id: request.folder_id } : {}),
      ...(request.title ? { title: request.title } : {}),
    });
    const response = await fetch(`${base}api/documents/upload?${query}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const body = await response.json() as { ok: boolean; value?: DocumentFile; error?: string };
    if (!body.ok || !body.value) throw new Error(body.error ?? `upload failed (HTTP ${response.status})`);
    return body.value;
  },
  getDocumentFile: (documentId: string) =>
    invoke<DocumentFile | null>("get_document_file", { documentId }),
  readDocumentFile: (documentId: string, maxBytes: number | null = null) =>
    invoke<DocumentFilePreview>("read_document_file", { documentId, maxBytes }),
  /** Desktop only: copy the stored upload to a path the person chose. The web build
   *  downloads through `api/documents/files/<id>` instead — see `fileDownloadUrl`. */
  exportFile: (documentId: string, targetPath: string) =>
    invoke<void>("export_document_file", { documentId, targetPath }),
  /** The web route that serves the stored bytes with their own filename. */
  fileDownloadUrl: (documentId: string) => `${import.meta.env.BASE_URL}api/documents/files/${encodeURIComponent(documentId)}`,

  importFolder: (request: DocumentImportRequest) =>
    invoke<DocumentImportSummary>("import_document_folder", { request }),

  // folders
  listDocumentFolders: () => invoke<DocumentFolder[]>("list_document_folders"),
  createDocumentFolder: (folder: DocumentFolder, ownerId: string | null = null) => invoke<void>("create_document_folder", { folder, ownerId }),
  updateDocumentFolder: (folder: DocumentFolder) => invoke<void>("update_document_folder", { folder }),
  moveDocumentFolder: (id: string, parentId: string | null) =>
    invoke<void>("move_document_folder", { id, parentId }),

  // read-only cross-lane lookups (owned elsewhere, only invoked here)
  listProfiles: () => invoke<{ id: string; username: string; display_name: string; archived?: boolean }[]>("list_profiles"),
  listTeams: () => invoke<{ id: string; name: string; archived?: boolean }[]>("list_teams"),
  /** `created_by` comes along because the library must know who OWNS a project
   *  before it offers to delete anything inside it. */
  listProjects: () => invoke<{ id: string; name: string; key: string; created_by: string | null }[]>("list_projects"),
};
