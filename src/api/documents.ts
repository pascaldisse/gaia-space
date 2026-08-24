// Documents / Knowledge Base API surface — thin invoke() wrappers over
// src-tauri/src/documents.rs. Kept standalone from ../api.ts (owned by another lane):
// types + calls needed by views/Documents.tsx + views/Documents.css only.
import { invoke } from "@tauri-apps/api/core";

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
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
export type DocumentBodyFormat = "text" | "rich-text" | "checklist" | "code";

export type Document = {
  id: string;
  container_type: string;
  container_id: string | null;
  folder_id: string | null;
  doc_type: DocType;
  body_format: DocumentBodyFormat;
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

export const documentsApi = {
  // documents
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
  listBookAccess: (bookId: string) =>
    invoke<DocumentAccessRecipient[]>("list_book_access", { bookId }),
  updateBookAccess: (bookId: string, permissions: DocumentAccessRecipient[]) =>
    invoke<void>("update_book_access", { bookId, permissions: permissions.map(({ recipient_id, ...permission }) => ({ ...permission, member_id: recipient_id })) }),
  searchBookDocuments: (bookId: string, query: string) =>
    invoke<DocumentSearchResult[]>("search_book_documents", { bookId, query }),

  // Favourites: a pointer from a person to a document that lives elsewhere.
  listFavorites: (profileId: string) =>
    invoke<Document[]>("list_favorite_documents", { profileId }),
  setFavorite: (profileId: string, documentId: string, favorite: boolean) =>
    invoke<void>("set_document_favorite", { profileId, documentId, favorite }),

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
  listProjects: () => invoke<{ id: string; name: string; key: string }[]>("list_projects"),
};
