/** P107: Export on a server-mode data table writes every row matching its search and filters,
 * not just the page shown: this fetches the same list page by page (100 at a time, the same
 * `?q=&sort=` and filters as the table) until X-Total-Count is reached. */
import type { TableState } from "@/components/ui/data-table";
import { tableParams, withParams } from "@/components/ui/data-table";
import { apiWithHeaders } from "@/lib/api";

/** At most this many rows go into one file (50 pages of 100). */
export const EXPORT_CAP = 5000;

export async function everyRow<T, B = T[]>(
  url: string,
  state: TableState,
  extra: Record<string, string | number | boolean | null | undefined> = {},
  pick?: (body: B) => T[],
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < EXPORT_CAP; page++) {
    const href = withParams(url, { ...extra, ...tableParams({ ...state, page, size: 100 }) });
    const { data, headers } = await apiWithHeaders<B>(href);
    const rows = pick ? pick(data) : (data as unknown as T[]);
    out.push(...rows);
    const total = Number(headers.get("X-Total-Count") ?? out.length);
    if (!rows.length || out.length >= total) break;
  }
  return out.slice(0, EXPORT_CAP);
}
