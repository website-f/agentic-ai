/** The Library's Browse tab (the /files page): which folder to show. "folders" is the company's
 * own folder tree; the rest are ready-made folders: documents, SOPs, guidelines (files in the
 * library), templates, and quick views of the file store (review, by task, recent, made by AI,
 * from websites, uploaded). */
export type StoreView =
  | "folders"
  | "documents"
  | "sops"
  | "library"
  | "templates"
  | "review"
  | "tasks"
  | "recent"
  | "agents"
  | "downloads"
  | "uploaded";
export const STORE_VIEWS: readonly StoreView[] = [
  "folders", "documents", "sops", "library", "templates", "review", "tasks", "recent", "agents", "downloads", "uploaded",
];
/** The views that list files (the file store's own lists). */
export type FileView = Exclude<StoreView, "folders" | "documents" | "sops" | "templates">;
