import { supabaseAdmin } from "@/lib/supabase-server";
import { type HabitRow } from "@/lib/habits";
import HabitDashboard from "./HabitDashboard";

export const dynamic = "force-dynamic";

export default async function HabitsPage() {
  const { data, error } = await supabaseAdmin.from("habits").select("*").order("created_at", { ascending: true });

  return <HabitDashboard initialHabits={(data ?? []) as HabitRow[]} loadError={error?.message ?? null} />;
}
