import crypto from "crypto";
import { supabaseAdmin } from "./supabase-server";
import { sendPushToAll } from "./push";
import { eb, type EbTransaction } from "./enable-banking";

// Pulls booked transactions from the linked bank accounts into
// economy_transactions. Each row gets an external_id (iban + the bank's
// reference) so re-fetching an overlapping window never duplicates.
// Transfers between the owner's own linked accounts are skipped, so moving
// money from Danske to Revolut isn't counted as both expense and income.
// New rows are categorised by economy_category_rules (merchant -> category),
// otherwise "Uncategorized".

export const UNCATEGORIZED = "Uncategorized";
const OVERLAP_DAYS = 5; // re-read a few days back: late-booked items appear after their date

type AccountRow = {
  id: number;
  uid: string;
  iban: string;
  aspsp_name: string;
  sync_from: string;
  last_synced_at: string | null;
  connection: { valid_until: string } | null;
};

export function cleanMerchant(s: string) {
  return s.replace(/\s+/g, " ").trim().slice(0, 100);
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fetchTransactions(uid: string, dateFrom: string) {
  const all: EbTransaction[] = [];
  let continuation: string | undefined;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ date_from: dateFrom });
    if (continuation) q.set("continuation_key", continuation);
    const res = await eb<{ transactions: EbTransaction[]; continuation_key?: string | null }>(
      `/accounts/${encodeURIComponent(uid)}/transactions?${q}`
    );
    all.push(...(res.transactions ?? []));
    if (!res.continuation_key) break;
    continuation = res.continuation_key;
  }
  return all;
}

export type SyncResult = { iban: string; imported: number; skipped: number; error?: string };

export async function syncBankAccounts(onlyAccountId?: number): Promise<SyncResult[]> {
  let query = supabaseAdmin
    .from("bank_accounts")
    .select("id, uid, iban, aspsp_name, sync_from, last_synced_at, connection:bank_connections(valid_until)")
    .eq("included", true);
  if (onlyAccountId) query = query.eq("id", onlyAccountId);
  const [{ data: accounts, error }, { data: allAccounts }, { data: rules }] = await Promise.all([
    query,
    supabaseAdmin.from("bank_accounts").select("iban"),
    supabaseAdmin.from("economy_category_rules").select("merchant, category"),
  ]);
  if (error) throw new Error(error.message);

  const ownIbans = new Set((allAccounts ?? []).map(a => a.iban.replace(/\s/g, "").toUpperCase()));
  const ruleMap = new Map((rules ?? []).map(r => [r.merchant.toLowerCase(), r.category]));
  const results: SyncResult[] = [];

  for (const acc of (accounts ?? []) as unknown as AccountRow[]) {
    if (!acc.connection || new Date(acc.connection.valid_until) <= new Date()) {
      results.push({ iban: acc.iban, imported: 0, skipped: 0, error: "Bank access expired — reconnect" });
      continue;
    }
    try {
      let from = acc.sync_from;
      if (acc.last_synced_at) {
        const d = new Date(acc.last_synced_at);
        d.setUTCDate(d.getUTCDate() - OVERLAP_DAYS);
        if (isoDate(d) > from) from = isoDate(d);
      }

      const txs = await fetchTransactions(acc.uid, from);
      const seen = new Map<string, number>();
      const rows = [];
      let skipped = 0;

      for (const t of txs) {
        if (t.status && t.status !== "BOOK") continue;
        const date = t.booking_date ?? t.value_date ?? t.transaction_date;
        if (!date || date < acc.sync_from) continue;

        const debit = t.credit_debit_indicator === "DBIT";
        const counterIban = (debit ? t.creditor_account?.iban : t.debtor_account?.iban)?.replace(/\s/g, "").toUpperCase();
        if (counterIban && ownIbans.has(counterIban)) {
          skipped++;
          continue;
        }

        const amount = Math.abs(parseFloat(t.transaction_amount.amount));
        if (!Number.isFinite(amount) || amount === 0) continue;
        const remittance = (t.remittance_information ?? []).join(" ");
        let merchant = cleanMerchant((debit ? t.creditor?.name : t.debtor?.name) || remittance || "Unknown");
        if (t.transaction_amount.currency && t.transaction_amount.currency !== "DKK") {
          merchant = cleanMerchant(`${merchant} (${t.transaction_amount.currency})`);
        }

        // Prefer the bank's own reference; otherwise hash the visible fields,
        // numbering repeats (two identical coffees the same day) in fetch order.
        let ref = t.entry_reference || t.transaction_id;
        if (!ref) {
          const h = crypto.createHash("sha1").update([date, t.transaction_amount.amount, t.credit_debit_indicator, remittance, merchant].join("|")).digest("hex").slice(0, 16);
          const n = (seen.get(h) ?? 0) + 1;
          seen.set(h, n);
          ref = `h:${h}:${n}`;
        }

        rows.push({
          description: ruleMap.get(merchant.toLowerCase()) ?? UNCATEGORIZED,
          merchant,
          amount,
          type: debit ? "expense" : "income",
          occurred_on: date,
          external_id: `${acc.iban}:${ref}`,
          bank_account_id: acc.id,
        });
      }

      // Skip rows already imported (unique partial index on external_id is the backstop).
      let imported = 0;
      if (rows.length) {
        const existing = new Set<string>();
        for (let i = 0; i < rows.length; i += 200) {
          const { data: ex, error: exErr } = await supabaseAdmin
            .from("economy_transactions")
            .select("external_id")
            .in("external_id", rows.slice(i, i + 200).map(r => r.external_id));
          if (exErr) throw new Error(exErr.message);
          for (const r of ex ?? []) existing.add(r.external_id);
        }
        const fresh = rows.filter(r => !existing.has(r.external_id));
        if (fresh.length) {
          const { data: inserted, error: insErr } = await supabaseAdmin.from("economy_transactions").insert(fresh).select("id");
          if (insErr) throw new Error(insErr.message);
          imported = inserted?.length ?? 0;
        }
      }

      await supabaseAdmin.from("bank_accounts").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", acc.id);
      results.push({ iban: acc.iban, imported, skipped });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("bank_accounts").update({ last_error: msg.slice(0, 300) }).eq("id", acc.id);
      results.push({ iban: acc.iban, imported: 0, skipped: 0, error: msg });
    }
  }
  return results;
}

// Daily: push a reminder while any bank connection expires within a week
// (Settings → Notifications → "Bank access expiring").
export async function remindExpiringBankAccess(now = new Date()) {
  const { data: toggle } = await supabaseAdmin.from("notification_toggles").select("enabled").eq("id", "bank_expiry").maybeSingle();
  if (toggle && !toggle.enabled) return [];
  const soon = new Date(now.getTime() + 7 * 86400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("bank_connections")
    .select("aspsp_name, valid_until")
    .gt("valid_until", now.toISOString())
    .lte("valid_until", soon);
  const sent: string[] = [];
  for (const c of data ?? []) {
    const days = Math.max(1, Math.ceil((new Date(c.valid_until).getTime() - now.getTime()) / 86400_000));
    await sendPushToAll(`🏦 ${c.aspsp_name} access expires in ${days} day${days === 1 ? "" : "s"} — reconnect`, "", {
      url: "/lab/economy",
      app: "general",
    });
    sent.push(c.aspsp_name);
  }
  return sent;
}
