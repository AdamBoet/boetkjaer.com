import { supabaseAdmin } from "./supabase-server";

export interface ReviewLogRow {
  source: string;
  db_id: string;
  ease: number;
  last_interval: number;
  time_taken_ms: number;
  review_type: number;
  reviewed_at: string;
}

const SELECT_COLUMNS = "source, db_id, ease, last_interval, time_taken_ms, review_type, reviewed_at";
const PAGE_SIZE = 1000;

// PostgREST caps a single request at 1000 rows. Getting the total count up
// front lets every remaining page fire in parallel instead of paging
// through sequentially, which used to mean one full network round trip per
// 1000 rows before the next page could even start.
export async function fetchReviewLogRows(filters: { since?: string; source?: string } = {}): Promise<ReviewLogRow[]> {
  function baseQuery(withCount: boolean) {
    let q = supabaseAdmin
      .from("review_log")
      .select(SELECT_COLUMNS, withCount ? { count: "exact" } : undefined)
      .order("reviewed_at", { ascending: true });
    if (filters.since) q = q.gte("reviewed_at", filters.since);
    if (filters.source) q = q.eq("source", filters.source);
    return q;
  }

  const { data: firstPage, error: firstError, count } = await baseQuery(true).range(0, PAGE_SIZE - 1);
  if (firstError) throw new Error(firstError.message);

  let rows = (firstPage ?? []) as unknown as ReviewLogRow[];
  const total = count ?? rows.length;

  if (total > PAGE_SIZE) {
    const offsets: number[] = [];
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) offsets.push(offset);
    const pages = await Promise.all(offsets.map((offset) => baseQuery(false).range(offset, offset + PAGE_SIZE - 1)));
    for (const page of pages) {
      if (page.error) throw new Error(page.error.message);
      rows = rows.concat((page.data ?? []) as unknown as ReviewLogRow[]);
    }
  }

  return rows;
}
