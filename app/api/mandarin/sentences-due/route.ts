import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Feeds the Claude scheduled task that generates hsk3_words/words_phrases
// example sentences (mandarin-pipeline/daily_refresh.py's generate_sentence()
// used a local 1.5B model — poor quality; this replaces just the sentence
// text generation with real Claude reasoning, while daily_refresh.py still
// generates pinyin + audio locally afterward, since that needs macOS).
//
// Due-date logic mirrors mandarin-pipeline/daily_refresh.py's
// due_diff()/is_due_today() exactly, including anchoring "today" to
// Europe/Copenhagen local time (not UTC) the same way that script's
// datetime.fromtimestamp(mod) does implicitly on the Mac it runs on.

type Card = {
  word: string;
  meaning: string | null;
  mod: number | null;
  interval: number | null;
  reps: number | null;
  type: number | null;
  generated_at: string | null;
};

const COPENHAGEN = "Europe/Copenhagen";

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function dueDiffDays(modUnix: number | null, interval: number | null): number | null {
  if (!modUnix || !interval) return null;
  const reviewed = new Date(modUnix * 1000);
  const dueDay = new Date(reviewed);
  dueDay.setDate(dueDay.getDate() + interval);
  const dueKey = dayKey(dueDay, COPENHAGEN);
  const todayKey = dayKey(new Date(), COPENHAGEN);
  // Compare as UTC midnight instants of the same Y-M-D strings so DST
  // shifts during the interval don't skew the day count.
  const dueUTC = Date.parse(dueKey + "T00:00:00Z");
  const todayUTC = Date.parse(todayKey + "T00:00:00Z");
  return Math.round((dueUTC - todayUTC) / 86400000);
}

function isDueToday(c: Card): boolean {
  const reps = c.reps ?? 0;
  if (reps > 0 && (c.type === 1 || c.type === 3)) return true;
  if (reps === 0) return false;
  const dd = dueDiffDays(c.mod, c.interval);
  return dd !== null && dd <= 0;
}

function needsRefresh(c: Card): boolean {
  if (!c.generated_at || !c.mod) return true;
  return new Date(c.generated_at).getTime() < c.mod * 1000;
}

export async function GET() {
  const [hsk3Rows, wpRows, settingsRows] = await Promise.all([
    (async () => {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseAdmin
          .from("hsk3_words")
          .select("word,meaning,mod,interval,reps,type,sentence_generated_at")
          .eq("known", true)
          .range(from, from + 999);
        if (error || !data) break;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return rows;
    })(),
    (async () => {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseAdmin
          .from("words_phrases")
          .select("note_id,word,meaning,source,mod,interval,reps,type,example_generated_at")
          .in("source", ["random_words", "idioms"])
          .range(from, from + 999);
        if (error || !data) break;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return rows;
    })(),
    supabaseAdmin.from("hanzi_settings").select("*"),
  ]);

  const settingsByDeck: Record<string, { sentence_max_chars?: number }> = {};
  for (const row of settingsRows.data ?? []) {
    settingsByDeck[row.deck as string] = row as { sentence_max_chars?: number };
  }

  const hsk3Due = (hsk3Rows as unknown as { word: string; meaning: string | null; mod: number | null; interval: number | null; reps: number | null; type: number | null; sentence_generated_at: string | null }[])
    .map((c) => ({ ...c, generated_at: c.sentence_generated_at }))
    .filter((c) => isDueToday(c) && needsRefresh(c))
    .map((c) => ({
      table: "hsk3_words" as const,
      key: c.word,
      word: c.word,
      meaning: c.meaning,
      deck: "hsk3",
      max_chars: settingsByDeck.hsk3?.sentence_max_chars ?? 15,
    }));

  const wpDue = (wpRows as unknown as { note_id: number; word: string; meaning: string | null; source: string; mod: number | null; interval: number | null; reps: number | null; type: number | null; example_generated_at: string | null }[])
    .map((c) => ({ ...c, generated_at: c.example_generated_at }))
    .filter((c) => isDueToday(c) && needsRefresh(c))
    .map((c) => ({
      table: "words_phrases" as const,
      key: c.note_id,
      word: c.word,
      meaning: c.meaning,
      deck: c.source,
      max_chars: settingsByDeck[c.source]?.sentence_max_chars ?? 15,
    }));

  return NextResponse.json({ due: [...hsk3Due, ...wpDue] });
}
