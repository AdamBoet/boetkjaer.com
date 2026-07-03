import type { HanziCard } from "./CharacterGrid";

export function cardDueDiff(card: HanziCard): number | null {
  if (!card.mod || !card.interval) return null;
  const r = new Date(card.mod * 1000);
  const dueDay = new Date(r.getFullYear(), r.getMonth(), r.getDate() + card.interval);
  const t = new Date();
  const todayDay = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((dueDay.getTime() - todayDay.getTime()) / 86400000);
}
