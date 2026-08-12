import type { Metadata } from "next";
import HanziDashboard from "./HanziDashboard";
import { fetchMandarinData } from "./fetch-mandarin-data";

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
  const { stats, cards, wordsPhrases, hsk3Coverage } = await fetchMandarinData();

  return (
    <HanziDashboard
      initialStats={stats}
      initialCards={cards}
      hsk3Coverage={hsk3Coverage}
      wordsPhrases={wordsPhrases}
    />
  );
}
