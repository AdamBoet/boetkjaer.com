import crypto from "crypto";
import { supabaseAdmin } from "./supabase-server";
import { sendPushToAll } from "./push";
import { eb, type EbTransaction } from "./enable-banking";
import { removeMatchedPlaceholders } from "./economy";

// Pulls booked transactions from the linked bank accounts into
// economy_transactions. Each row gets an external_id (iban + the bank's
// reference) so re-fetching an overlapping window never duplicates.
// Transfers between the owner's own linked accounts are labelled "Transfer"
// (kept out of totals), so moving money between them isn't counted as both
// expense and income.
// New rows are categorised by economy_category_rules (merchant -> category),
// otherwise "Uncategorized".

export const UNCATEGORIZED = "Uncategorized";
// Money moved between the owner's own accounts. Kept visible in the list but
// left out of totals and Net (see EXCLUDED_CATEGORIES in EconomyDashboard).
export const TRANSFER = "Transfer";
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
  // Danish IBAN = DKkk + 4-digit reg. no. + 10-digit account no. Danske's
  // transfer texts quote "reg account" instead of the IBAN.
  const ownAccountNumbers = [...ownIbans].filter(i => i.startsWith("DK") && i.length === 18).map(i => i.slice(-10));
  // A rule matches when its merchant text appears in the transaction's
  // merchant (so "netto" covers every Netto store); the longest match wins.
  const ruleList = (rules ?? [])
    .map(r => ({ key: r.merchant.toLowerCase(), category: r.category }))
    .sort((a, b) => b.key.length - a.key.length);
  const categoryFor = (merchant: string) => {
    const m = merchant.toLowerCase();
    return ruleList.find(r => m.includes(r.key))?.category;
  };
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
        const text = `${(debit ? t.creditor?.name : t.debtor?.name) ?? ""} ${(t.remittance_information ?? []).join(" ")}`.replace(/\s/g, "");
        const isTransfer = (counterIban && ownIbans.has(counterIban)) || ownAccountNumbers.some(n => text.includes(n));

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
          description: isTransfer ? TRANSFER : categoryFor(merchant) ?? UNCATEGORIZED,
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
      if (imported) {
        await markTransferPairs();
        await removeMatchedPlaceholders();
      }
      results.push({ iban: acc.iban, imported, skipped });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("bank_accounts").update({ last_error: msg.slice(0, 300) }).eq("id", acc.id);
      results.push({ iban: acc.iban, imported: 0, skipped: 0, error: msg });
    }
  }
  return results;
}

// The other leg of an own-account transfer often carries no account number
// (e.g. incoming "ADAM BØTKJÆR"), so pair them up: an uncategorised expense
// and income of the same amount, on different own accounts, within 2 days.
export async function markTransferPairs() {
  const { data } = await supabaseAdmin
    .from("economy_transactions")
    .select("id, amount, type, occurred_on, bank_account_id, description")
    .not("bank_account_id", "is", null)
    .in("description", [UNCATEGORIZED, TRANSFER]);
  const rows = data ?? [];
  const used = new Set<number>();
  const ids: number[] = [];
  const day = (d: string) => new Date(d).getTime() / 86400_000;
  for (const out of rows.filter(r => r.type === "expense")) {
    const match = rows.find(
      r =>
        r.type === "income" &&
        !used.has(r.id) &&
        r.bank_account_id !== out.bank_account_id &&
        Number(r.amount) === Number(out.amount) &&
        Math.abs(day(r.occurred_on) - day(out.occurred_on)) <= 2 &&
        (r.description === UNCATEGORIZED || out.description === UNCATEGORIZED)
    );
    if (!match) continue;
    used.add(match.id);
    if (out.description !== TRANSFER) ids.push(out.id);
    if (match.description !== TRANSFER) ids.push(match.id);
  }
  if (ids.length) await supabaseAdmin.from("economy_transactions").update({ description: TRANSFER }).in("id", ids);
  return ids.length;
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
