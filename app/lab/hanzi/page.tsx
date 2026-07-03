import { supabase } from "@/lib/supabase";
import staticStats from "@/data/anki-stats.json";
import staticCards from "@/data/hanzi-cards.json";
import HanziDashboard from "./HanziDashboard";
import { type HanziCard } from "./CharacterGrid";

export const dynamic = "force-dynamic";

export default async function HanziPage() {
  const { data: statsRow } = await supabase
    .from("anki_stats")
    .select("*")
    .eq("id", 1)
    .single();

  const { data: cardsRows } = await supabase
    .from("hanzi_cards")
    .select("*")
    .order("rank");

  const stats = statsRow ?? staticStats;
  const cards = (cardsRows?.length ? cardsRows : staticCards) as HanziCard[];

  return <HanziDashboard initialStats={stats} initialCards={cards} />;
}
