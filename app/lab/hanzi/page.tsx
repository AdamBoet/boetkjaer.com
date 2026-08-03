import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import staticStats from "@/data/anki-stats.json";
import staticCards from "@/data/hanzi-cards.json";
import hsk3Coverage from "@/data/hsk3-coverage.json";
import HanziDashboard from "./HanziDashboard";
import { type HanziCard } from "./CharacterGrid";
import { type Hsk3Coverage } from "./Hsk3Grid";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mandarin",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mandarin",
  },
};

export default async function HanziPage() {
  const [{ data: statsRow }, { data: cardsRows }] = await Promise.all([
    supabase.from("anki_stats").select("*").eq("id", 1).single(),
    supabase.from("hanzi_cards").select("*").order("rank"),
  ]);

  const stats = statsRow ?? staticStats;
  const cards = (cardsRows?.length ? cardsRows : staticCards) as HanziCard[];

  return (
    <HanziDashboard
      initialStats={stats}
      initialCards={cards}
      hsk3Coverage={hsk3Coverage as Hsk3Coverage}
    />
  );
}
