/** The file store's views (the /files page): which list of files to show. */
export type StoreView = "tasks" | "review" | "recent" | "agents" | "downloads" | "uploaded" | "library" | "folders";
export const STORE_VIEWS: readonly StoreView[] = ["review", "tasks", "recent", "agents", "downloads", "uploaded", "library", "folders"];
