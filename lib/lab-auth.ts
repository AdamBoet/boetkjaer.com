import { createHmac, timingSafeEqual } from "crypto";

export const LAB_SESSION_COOKIE = "lab_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function sign(payload: string) {
  return createHmac("sha256", process.env.LAB_SESSION_SECRET!).update(payload).digest("hex");
}

export function createSessionToken() {
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null) {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (Number(payload) < Date.now()) return false;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
