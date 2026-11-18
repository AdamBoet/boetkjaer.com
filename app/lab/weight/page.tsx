import { supabaseAdmin } from "@/lib/supabase-server";
import HealthDashboard from "./HealthDashboard";
import { type WeightEntry } from "./types";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const { data, error } = await supabaseAdmin
    .from("health_weight_entries")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <HealthDashboard
      initialEntries={(data ?? []).map(e => ({ ...e, weight_kg: Number(e.weight_kg) })) as WeightEntry[]}
      loadError={error?.message ?? null}
    />
  );
}
