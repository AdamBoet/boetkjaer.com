// Shared habit validation and quiet-hours math for /api/habits and
// /api/habit-tick. Quiet hours are wall-clock times in Copenhagen.

export const HABIT_TZ = "Europe/Copenhagen";
export const MIN_INTERVAL = 5;
export const MAX_INTERVAL = 43200; // 30 days

export type HabitRow = {
  id: number;
  name: string;
  interval_minutes: number;
  quiet_start: string | null; // "HH:MM:SS"
  quiet_end: string | null;
  active: boolean;
  next_due_at: string;
  created_at: string;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:\d\d)?$/;

function toMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// Wall-clock parts of `date` in Copenhagen.
export function localParts(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: HABIT_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map(p => [p.type, Number(p.value)]),
  );
  return { y: parts.year, mo: parts.month, d: parts.day, h: parts.hour, mi: parts.minute };
}

// UTC offset of Copenhagen at `date`, in ms.
function offsetAt(date: Date) {
  const p = localParts(date);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(date.getTime() / 60000) * 60000;
}

// Copenhagen wall time (y, mo, d, minutesOfDay) -> UTC instant.
function fromLocal(y: number, mo: number, d: number, minutes: number) {
  const guess = Date.UTC(y, mo - 1, d, 0, minutes);
  const first = guess - offsetAt(new Date(guess));
  return new Date(guess - offsetAt(new Date(first)));
}

export function inQuietHours(habit: Pick<HabitRow, "quiet_start" | "quiet_end">, now: Date) {
  if (!habit.quiet_start || !habit.quiet_end) return false;
  const start = toMinutes(habit.quiet_start);
  const end = toMinutes(habit.quiet_end);
  if (start === end) return false;
  const p = localParts(now);
  const t = p.h * 60 + p.mi;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

// The next moment quiet hours end, strictly after `now`.
export function quietEndAfter(habit: Pick<HabitRow, "quiet_end">, now: Date) {
  const p = localParts(now);
  const end = toMinutes(habit.quiet_end!);
  let at = fromLocal(p.y, p.mo, p.d, end);
  if (at <= now) at = fromLocal(p.y, p.mo, p.d + 1, end);
  return at;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseName(v: unknown): Parsed<string> {
  const name = typeof v === "string" ? v.trim() : "";
  if (!name || name.length > 100) return { ok: false, error: "name must be 1–100 characters" };
  return { ok: true, value: name };
}

export function parseInterval(v: unknown): Parsed<number> {
  const n = Number(v);
  if (!Number.isInteger(n) || n < MIN_INTERVAL || n > MAX_INTERVAL) {
    return { ok: false, error: `interval must be between ${MIN_INTERVAL} minutes and 30 days` };
  }
  return { ok: true, value: n };
}

// Both empty = no quiet hours; otherwise both must be HH:MM and differ.
export function parseQuiet(start: unknown, end: unknown): Parsed<{ quiet_start: string | null; quiet_end: string | null }> {
  const s = typeof start === "string" ? start.trim() : "";
  const e = typeof end === "string" ? end.trim() : "";
  if (!s && !e) return { ok: true, value: { quiet_start: null, quiet_end: null } };
  if (!TIME_RE.test(s) || !TIME_RE.test(e)) return { ok: false, error: "quiet hours need both a start and an end time" };
  if (toMinutes(s) === toMinutes(e)) return { ok: false, error: "quiet hours start and end must differ" };
  return { ok: true, value: { quiet_start: s.slice(0, 5), quiet_end: e.slice(0, 5) } };
}

export function nextDue(intervalMinutes: number, from = new Date()) {
  return new Date(from.getTime() + intervalMinutes * 60_000).toISOString();
}
