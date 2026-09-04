import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// PostgREST caps a single select() at 1000 rows by default — any table
// that can grow past that needs to page through in batches instead, or
// rows past the cap silently vanish from the result with no error (bit
// hanzi_cards once it crossed 1000 rows, after hsk3_words had already hit
// the same thing).
export async function fetchAllRows<T>(table: string, select: string, orderBy: string): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderBy)
      .range(from, from + pageSize - 1);
    if (error || !data) break;
    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return rows;
}
