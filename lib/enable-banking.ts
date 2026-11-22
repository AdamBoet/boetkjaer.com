import crypto from "crypto";

// Minimal Enable Banking (PSD2 account information) client. The app runs in
// restricted mode: it can only read the owner's own accounts that were
// linked in the Enable Banking control panel. Requests are authorised with a
// short-lived RS256 JWT signed by the app's private key (kid = app id).

const API = "https://api.enablebanking.com";
export const BANK_REDIRECT_URL = "https://boetkjaer.com/api/economy/bank/callback";

function jwt() {
  const appId = process.env.ENABLE_BANKING_APP_ID;
  const keyB64 = process.env.ENABLE_BANKING_PRIVATE_KEY_B64;
  if (!appId || !keyB64) throw new Error("Enable Banking is not configured (ENABLE_BANKING_APP_ID / ENABLE_BANKING_PRIVATE_KEY_B64)");
  const key = Buffer.from(keyB64, "base64").toString("utf8");
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ typ: "JWT", alg: "RS256", kid: appId });
  const body = enc({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${body}.${sig}`;
}

export async function eb<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${jwt()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error body
  }
  if (!res.ok) {
    const msg = (json as { message?: string; error?: string } | null)?.message ?? (json as { error?: string } | null)?.error ?? text.slice(0, 200);
    throw new Error(`Enable Banking ${res.status}: ${msg}`);
  }
  return json as T;
}

export type EbAccount = {
  uid: string;
  account_id?: { iban?: string; other?: { identification?: string } };
  name?: string;
  details?: string;
  product?: string;
  currency?: string;
};

export type EbSession = {
  session_id: string;
  accounts: EbAccount[];
  aspsp: { name: string; country: string };
  access: { valid_until: string };
};

export type EbTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  status?: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  creditor_account?: { iban?: string | null } | null;
  debtor_account?: { iban?: string | null } | null;
  remittance_information?: string[] | null;
};

export function accountIban(a: EbAccount) {
  return a.account_id?.iban ?? a.account_id?.other?.identification ?? a.uid;
}
