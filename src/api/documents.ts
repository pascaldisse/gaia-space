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

export type Document = {
  id: string;
  container_type: string;
  container_id: string | null;
  folder_id: string | null;
  doc_type: string;
  title: string;
  body: string | null;
  version: number;
  archived: boolean;
  created_by: string | null;
};

export type DocVersion = {
  id: string;
  document_id: string;
  version: number;
  body: string | null;
  created_by: string | null;
  created_at: number;
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

export const documentsApi = {
  // documents
  listDocuments: () => invoke<Document[]>("list_documents"),
  getDocument: (id: string) => invoke<Document | null>("get_document", { id }),
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
    invoke<void>("update_document_access", { documentId, permissions }),

  importFolder: (request: DocumentImportRequest) =>
    invoke<DocumentImportSummary>("import_document_folder", { request }),

  // folders
  listDocumentFolders: () => invoke<DocumentFolder[]>("list_document_folders"),
  createDocumentFolder: (folder: DocumentFolder) => invoke<void>("create_document_folder", { folder }),
  updateDocumentFolder: (folder: DocumentFolder) => invoke<void>("update_document_folder", { folder }),
  moveDocumentFolder: (id: string, parentId: string | null) =>
    invoke<void>("move_document_folder", { id, parentId }),

  // read-only cross-lane lookups (owned elsewhere, only invoked here)
  listProfiles: () => invoke<{ id: string; username: string; display_name: string; archived?: boolean }[]>("list_profiles"),
  listTeams: () => invoke<{ id: string; name: string; archived?: boolean }[]>("list_teams"),
  listProjects: () => invoke<{ id: string; name: string; key: string }[]>("list_projects"),
};
