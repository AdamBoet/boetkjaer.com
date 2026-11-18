"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type WeightEntry } from "./types";

type Range = "week" | "month" | "year";

const RANGES: { key: Range; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
];

const DAY = 86400000;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };

const kgFormat = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Start of the calendar period containing `t`: Monday-start week, 1st of month, or Jan 1.
function periodStart(range: Range, t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  if (range === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (range === "month") d.setDate(1);
  else d.setMonth(0, 1);
  return d.getTime();
}

// Move `t` by `n` whole weeks / months / years (calendar-aware).
function shift(range: Range, t: number, n: number) {
  const d = new Date(t);
  if (range === "week") d.setDate(d.getDate() + n * 7);
  else if (range === "month") d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d.getTime();
}

function currentPeriod(range: Range) {
  const from = periodStart(range, Date.now());
  return { from, to: shift(range, from, 1) };
}

function windowLabel(range: Range, from: number, to: number) {
  const s = new Date(from);
  const aligned = periodStart(range, from) === from && shift(range, from, 1) === to;
  if (aligned && range === "year") return String(s.getFullYear());
  if (aligned && range === "month") return s.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const e = new Date(to - 1);
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  const startStr = s.toLocaleDateString(
    "en-GB",
    sameMonth ? { day: "numeric" } : sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" },
  );
  return `${startStr}–${e.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

function niceStep(span: number, targetTicks: number) {
  const raw = span / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

// Ticks sit on fixed calendar dates so they glide with the data while panning.
function xTicks(range: Range, from: number, to: number) {
  const ticks: { t: number; label: string }[] = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  if (range === "year") {
    d.setDate(1);
    for (; d.getTime() <= to; d.setMonth(d.getMonth() + 1)) {
      if (d.getTime() >= from) ticks.push({ t: d.getTime(), label: d.toLocaleDateString("en-GB", { month: "short" }) });
    }
  } else {
    for (; d.getTime() <= to; d.setDate(d.getDate() + 1)) {
      if (d.getTime() < from) continue;
      if (range === "week") {
        ticks.push({ t: d.getTime(), label: d.toLocaleDateString("en-GB", { weekday: "short" }) });
      } else if ([1, 8, 15, 22, 29].includes(d.getDate())) {
        ticks.push({ t: d.getTime(), label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) });
      }
    }
  }
  return ticks;
}

export default function WeightChart({ entries }: { entries: WeightEntry[] }) {
  const [range, setRange] = useState<Range>("week");
  const [win, setWin] = useState(() => currentPeriod("week"));
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; from: number; to: number; swiping: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { from, to } = win;
  const maxTo = currentPeriod(range).to;
  const atEnd = to >= maxTo;

  const all = useMemo(
    () =>
      entries
        .map(e => ({ t: new Date(e.created_at).getTime(), w: e.weight_kg, id: e.id }))
        .sort((a, b) => a.t - b.t),
    [entries],
  );

  // Visible points, plus one neighbour on each side so the line runs off the edges.
  const firstIn = all.findIndex(p => p.t >= from);
  const lastIn = all.findLastIndex(p => p.t <= to);
  const visible = firstIn !== -1 && lastIn >= firstIn ? all.slice(firstIn, lastIn + 1) : [];
  const drawn = all.slice(
    Math.max((firstIn === -1 ? all.length : firstIn) - 1, 0),
    lastIn === -1 ? 0 : Math.min(lastIn + 2, all.length),
  );

  const innerW = Math.max(width - PAD.left - PAD.right, 50);
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const scaleSource = visible.length ? visible : drawn;
  const weights = scaleSource.map(p => p.w);
  let lo = Math.min(...weights);
  let hi = Math.max(...weights);
  if (!weights.length) { lo = 0; hi = 1; }
  if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
  const yStep = niceStep(hi - lo, 4);
  const yMin = Math.floor(lo / yStep) * yStep;
  const yMax = Math.ceil(hi / yStep) * yStep;
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += yStep) yTicks.push(Math.round(v * 10) / 10);

  const x = (t: number) => PAD.left + ((t - from) / (to - from)) * innerW;
  const y = (w: number) => PAD.top + (1 - (w - yMin) / (yMax - yMin)) * innerH;

  const path = drawn.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join("");
  const allTicks = xTicks(range, from, to);
  // Thin out labels on narrow screens so they don't collide (~36px per label).
  const tickEvery = Math.max(1, Math.ceil((allTicks.length * 36) / innerW));
  const ticks = allTicks.filter((_, i) => i % tickEvery === 0);


  function selectRange(r: Range) {
    setRange(r);
    setWin(currentPeriod(r));
    setHover(null);
  }

  function step(n: number) {
    setHover(null);
    setWin(w => {
      const nf = shift(range, w.from, n);
      const nt = shift(range, w.to, n);
      if (nt > maxTo) return { from: maxTo - (nt - nf), to: maxTo };
      return { from: nf, to: nt };
    });
  }

  function hoverAt(e: React.PointerEvent<HTMLDivElement>) {
    if (!visible.length) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    visible.forEach((p, i) => { if (Math.abs(x(p.t) - px) < Math.abs(x(visible[best].t) - px)) best = i; });
    setHover(best);
  }

  // Drag horizontally to pan continuously through time.
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { x: e.clientX, y: e.clientY, from, to, swiping: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    hoverAt(e);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) { if (e.pointerType === "mouse") hoverAt(e); return; }
    const dx = e.clientX - d.x;
    if (!d.swiping && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - d.y)) {
      d.swiping = true;
      setDragging(true);
      setHover(null);
    }
    if (!d.swiping) { hoverAt(e); return; }
    const span = d.to - d.from;
    let dt = (-dx / innerW) * span;
    if (d.to + dt > maxTo) dt = maxTo - d.to;
    setWin({ from: d.from + dt, to: d.to + dt });
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    setDragging(false);
    if (e.pointerType !== "mouse") setHover(null);
  }

  const hp = hover != null ? visible[hover] : null;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-4 sm:p-6">
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center justify-between sm:justify-start gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={`Previous ${range}`}
            className="rounded-md px-2 py-0.5 text-lg leading-none text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            ‹
          </button>
          <span className="flex-1 sm:flex-none sm:min-w-[11rem] text-center text-sm font-medium tabular-nums">
            {windowLabel(range, from, to)}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={atEnd}
            aria-label={`Next ${range}`}
            className="rounded-md px-2 py-0.5 text-lg leading-none text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            ›
          </button>
        </div>
        <div className="flex w-full sm:w-auto rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5 text-xs">
          {RANGES.map(r => (
            <button
              key={r.key}
              type="button"
              onClick={() => selectRange(r.key)}
              className={`flex-1 sm:flex-none rounded-md px-3 py-1 transition-colors ${
                range === r.key
                  ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-medium shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={boxRef}
        className={`mt-4 relative touch-pan-y select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={e => { if (!dragRef.current) setHover(null); else if (e.pointerType === "mouse") endDrag(e); }}
      >
        <svg width={width} height={HEIGHT} className="block">
          <defs>
            <clipPath id="weight-plot">
              <rect x={PAD.left} y={0} width={innerW} height={HEIGHT - PAD.bottom + 4} />
            </clipPath>
          </defs>

          {yTicks.map(v => (
            <g key={v}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(v)} y2={y(v)} className="stroke-zinc-100 dark:stroke-zinc-800" />
              <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-zinc-400 dark:fill-zinc-500 text-[11px] tabular-nums">
                {v}
              </text>
            </g>
          ))}
          {ticks.map(tk => (
            <text key={tk.t} x={x(tk.t)} y={HEIGHT - 8} textAnchor="middle" className="fill-zinc-400 dark:fill-zinc-500 text-[11px]">
              {tk.label}
            </text>
          ))}

          <g clipPath="url(#weight-plot)">
            <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-emerald-700 dark:stroke-emerald-500" />
            {visible.length <= 60 && drawn.map(p => (
              <circle key={p.id} cx={x(p.t)} cy={y(p.w)} r={3} className="fill-emerald-700 dark:fill-emerald-500" />
            ))}
          </g>

          {hp && (
            <g>
              <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-zinc-300 dark:stroke-zinc-600" strokeDasharray="3 3" />
              <circle cx={x(hp.t)} cy={y(hp.w)} r={5} strokeWidth={2} className="fill-white dark:fill-zinc-900 stroke-emerald-700 dark:stroke-emerald-500" />
            </g>
          )}
        </svg>

        {!visible.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
            No entries in this period
          </div>
        )}

        {hp && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs shadow-sm whitespace-nowrap"
            style={{ left: Math.min(Math.max(x(hp.t), 60), width - 60) }}
          >
            <div className="font-semibold tabular-nums">{kgFormat.format(hp.w)} kg</div>
            <div className="text-zinc-400 dark:text-zinc-500">
              {new Date(hp.t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
