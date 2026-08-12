import { type ReviewLogRow } from "./review-log";

export interface TodayStats {
  count: number;
  minutes: number;
  secPerCard: number;
  again: number;
  againPct: number;
  learn: number;
  review: number;
  relearn: number;
  matureTotal: number;
  matureCorrect: number;
}

export interface HourlyStat {
  hour: number;
  count: number;
  correct: number;
  pct: number | null;
}

export interface AnswerButtonsStage {
  stage: "Learning" | "Young" | "Mature";
  counts: number[]; // [again, hard, good, easy]
}

export interface StatsAggregate {
  today: TodayStats;
  calendarByDate: Record<string, number>;
  hourlyStats: HourlyStat[];
  answerButtons: AnswerButtonsStage[];
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The one place that turns raw review_log rows into everything the
// Statistics tab's Today/Calendar/Hourly/Answer-buttons sections need —
// shared by the on-demand bootstrap fetch and the background recompute job
// so the two never drift out of sync.
export function aggregateReviewLog(rows: ReviewLogRow[]): StatsAggregate {
  const todayKey = localDateKey(new Date());
  const todays = rows.filter((r) => localDateKey(new Date(r.reviewed_at)) === todayKey);
  const timeMs = todays.reduce((s, r) => s + r.time_taken_ms, 0);
  const again = todays.filter((r) => r.ease === 1).length;
  const learn = todays.filter((r) => r.review_type === 0).length;
  const review = todays.filter((r) => r.review_type === 1).length;
  const relearn = todays.filter((r) => r.review_type === 2).length;
  const matureReviews = todays.filter((r) => r.last_interval >= 21);
  const matureCorrect = matureReviews.filter((r) => r.ease > 1).length;

  const calendarByDate: Record<string, number> = {};
  for (const r of rows) {
    const key = localDateKey(new Date(r.reviewed_at));
    calendarByDate[key] = (calendarByDate[key] ?? 0) + 1;
  }

  const hourCounts = new Array(24).fill(0);
  const hourCorrect = new Array(24).fill(0);
  for (const r of rows) {
    const h = new Date(r.reviewed_at).getHours();
    hourCounts[h]++;
    if (r.ease > 1) hourCorrect[h]++;
  }
  const hourlyStats: HourlyStat[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    count: hourCounts[h],
    correct: hourCorrect[h],
    pct: hourCounts[h] > 0 ? Math.round((hourCorrect[h] / hourCounts[h]) * 1000) / 10 : null,
  }));

  const stages = ["Learning", "Young", "Mature"] as const;
  const grid: Record<(typeof stages)[number], number[]> = {
    Learning: [0, 0, 0, 0],
    Young: [0, 0, 0, 0],
    Mature: [0, 0, 0, 0],
  };
  for (const r of rows) {
    const stage: (typeof stages)[number] =
      r.review_type === 0 || r.review_type === 2 ? "Learning" : r.last_interval >= 21 ? "Mature" : "Young";
    const easeIdx = Math.min(3, Math.max(0, r.ease - 1));
    grid[stage][easeIdx]++;
  }
  const answerButtons: AnswerButtonsStage[] = stages.map((stage) => ({ stage, counts: grid[stage] }));

  return {
    today: {
      count: todays.length,
      minutes: timeMs / 60000,
      secPerCard: todays.length > 0 ? timeMs / todays.length / 1000 : 0,
      again,
      againPct: todays.length > 0 ? (again / todays.length) * 100 : 0,
      learn,
      review,
      relearn,
      matureTotal: matureReviews.length,
      matureCorrect,
    },
    calendarByDate,
    hourlyStats,
    answerButtons,
  };
}
