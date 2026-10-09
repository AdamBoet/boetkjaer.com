"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HotkeysPanel, HotkeyRow, TIMER_STRIPES } from "./FlashcardTab";

const HAN = /\p{Script=Han}/u;
const CELL_PX = 44; // fixed width per character, so the strip moves exactly one cell per answer
const FLASH_MS = 250;

// Hand-written text using only characters studied in the hanzi deck
// (checked against hanzi_cards with reps > 0 on 2026-10-09), split into
// clauses (each ending in ，。！？) with their English translation. `PINYIN`
// has one syllable per Han character as pronounced here; the expected tone
// is read off its tone mark (no mark = neutral). Dictionary tones, except
// the lexically neutral syllables (先生, 早上/晚上, locative 上, 村子, 的,
// 得); 不 keeps its citation tone bù.
//
// Length rule: a whole sentence's English (its clauses joined, up to 。！？)
// should stay at or under 120 characters so the translation line under the
// box stays readable. (The 退休以后… sentence, at 134, is grandfathered in.)
const CLAUSES: [string, string][] = [
  ["赵先生年轻时是海军军官，", "When Mr. Zhao was young, he was a naval officer,"],
  ["曾在战舰上工作多年。", "and worked on a warship for many years."],
  ["退休以后，", "After retiring,"],
  ["他既不愿留在城市，", "he neither wanted to stay in the city"],
  ["又不想依靠子女，", "nor to rely on his children,"],
  ["于是独自回到南方的老家。", "so he went back alone to his old home in the south."],
  ["村子虽然不大，", "The village isn't big,"],
  ["但山清水秀，", "but the hills are green and the water clear,"],
  ["空气新鲜。", "and the air is fresh."],
  ["他每天早上去河边散步，", "Every morning he takes a walk by the river,"],
  ["晚上读书写字。", "and in the evenings he reads and practises writing."],
  ["尽管生活简单，", "Although his life is simple,"],
  ["他却觉得非常满足。", "he feels very content."],
];

const PINYIN =
  "zhào xiān sheng nián qīng shí shì hǎi jūn jūn guān céng zài zhàn jiàn shang gōng zuò duō nián " +
  "tuì xiū yǐ hòu tā jì bù yuàn liú zài chéng shì yòu bù xiǎng yī kào zǐ nǚ yú shì dú zì huí dào nán fāng de lǎo jiā " +
  "cūn zi suī rán bù dà dàn shān qīng shuǐ xiù kōng qì xīn xiān tā měi tiān zǎo shang qù hé biān sàn bù " +
  "wǎn shang dú shū xiě zì jǐn guǎn shēng huó jiǎn dān tā què jué de fēi cháng mǎn zú";

interface Char {
  ch: string;
  pinyin: string | null; // null for punctuation
  tone: number | null;
  clause: number; // index into CLAUSES
}

function toneOf(syllable: string): number {
  const d = syllable.normalize("NFD");
  if (d.includes("̄")) return 1;
  if (d.includes("́")) return 2;
  if (d.includes("̌")) return 3;
  if (d.includes("̀")) return 4;
  return 5;
}

function buildText(): Char[] {
  const syllables = PINYIN.split(" ");
  let s = 0;
  return CLAUSES.flatMap(([text], clause) =>
    Array.from(text).map((ch) => {
      if (!HAN.test(ch)) return { ch, pinyin: null, tone: null, clause };
      const p = syllables[s++];
      return { ch, pinyin: p, tone: toneOf(p), clause };
    }),
  );
}

// Reading position survives leaving the tab/page; only Restart clears it.
// Stored with the pinyin as a fingerprint so editing the text resets it
// instead of resuming at a position that no longer matches.
const PROGRESS_KEY = "text_tab_progress";

function loadProgress(): number | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "null");
    return saved?.text === PINYIN && typeof saved.cursor === "number" ? saved.cursor : null;
  } catch {
    return null;
  }
}

function saveProgress(cursor: number | null) {
  try {
    if (cursor == null) localStorage.removeItem(PROGRESS_KEY);
    else localStorage.setItem(PROGRESS_KEY, JSON.stringify({ text: PINYIN, cursor }));
  } catch {
    // storage unavailable (private mode etc.) — progress just won't persist
  }
}

function nextHan(chars: Char[], from: number) {
  let i = from;
  while (i < chars.length && chars[i].tone == null) i++;
  return i;
}

// Tone-drill reading game: one line of text slides through a box with the
// current character held in the center. Answer its tone with 1–4, or 5 /
// Space for neutral. Correct flashes green, reveals its pinyin above it and
// slides the line one character left (punctuation is skipped); wrong flashes
// red and stays. Passing a clause's closing punctuation adds its translation
// to the paragraph under the box, so the meaning is revealed as you go.
export default function TextTab() {
  const [chars, setChars] = useState<Char[]>([]);
  const [round, setRound] = useState(0); // remounts the strip so a new text doesn't animate back
  const [cursor, setCursor] = useState(0);
  const [flash, setFlash] = useState<{ index: number; kind: "correct" | "wrong" } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const regenerate = useCallback(() => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    saveProgress(null);
    const next = buildText();
    setChars(next);
    setCursor(nextHan(next, 0));
    setFlash(null);
    setRound((r) => r + 1);
  }, []);

  // Built after mount (not during render) so reading saved progress from
  // localStorage doesn't cause a server/client hydration mismatch.
  useEffect(() => {
    const next = buildText();
    const saved = loadProgress();
    setChars(next);
    setCursor(saved != null && saved <= next.length ? saved : nextHan(next, 0));
  }, []);

  const answer = useCallback(
    (tone: number) => {
      const current = chars[cursor];
      if (!current || current.tone == null) return;
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);

      if (tone !== current.tone) {
        setFlash({ index: cursor, kind: "wrong" });
        return;
      }
      setFlash({ index: cursor, kind: "correct" });
      const next = nextHan(chars, cursor + 1);
      setCursor(next);
      saveProgress(next);
    },
    [chars, cursor],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        answer(Number(e.key));
      } else if (e.key === " ") {
        e.preventDefault();
        answer(5);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // Center of the current cell sits on the box's center line. Past the last
  // character it keeps the final position, so the line doesn't jump.
  const centered = Math.min(cursor, Math.max(chars.length - 1, 0));

  // A clause counts as read once the cursor has moved past its closing
  // punctuation (the last character of the clause).
  const revealed = CLAUSES.filter((_, clause) => {
    let last = -1;
    chars.forEach((c, i) => {
      if (c.clause === clause) last = i;
    });
    return last >= 0 && last < cursor;
  });

  // Progress through the whole text, counting Han characters only.
  const totalHan = chars.filter((c) => c.tone != null).length;
  const doneHan = chars.filter((c, i) => c.tone != null && i < cursor).length;
  const progressPct = totalHan ? (doneHan / totalHan) * 100 : 0;

  // Read clauses run together into sentences; each 。！？ starts a new line.
  const sentences: { chinese: string; english: string[] }[] = [];
  let open = true; // whether the last sentence is still unfinished
  for (const [chinese, english] of revealed) {
    if (open && sentences.length) {
      sentences[sentences.length - 1].chinese += chinese;
      sentences[sentences.length - 1].english.push(english);
    } else {
      sentences.push({ chinese, english: [english] });
    }
    open = !/[。！？]$/.test(chinese);
  }

  return (
    // Fills the space below the tab bar so the box sits vertically centered
    // on the page (nudged up by the bottom padding); hotkeys live in the
    // top-right corner, clear of the box.
    <div className="relative flex min-h-[calc(100dvh-9rem)] items-center justify-center pb-32">
      {/* Same striped pill as the flashcard review's timer, centered in the
          top row like it, filling (in its green) instead of draining; the
          done/total count (grey) hangs below the bar. */}
      <div className="pointer-events-none absolute left-1/2 top-0.5 -translate-x-1/2" aria-hidden>
        <div className="relative h-4 w-24 overflow-hidden rounded-full bg-zinc-200 sm:w-48 lg:w-72 dark:bg-zinc-800">
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-200 ease-out"
            style={{ width: `${progressPct}%`, backgroundColor: "rgb(4, 120, 87)", backgroundImage: TIMER_STRIPES }}
          />
        </div>
        <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
          {doneHan}/{totalHan}
        </span>
      </div>
      <div className="absolute right-0 top-0 flex items-center gap-4">
        <button
          onClick={(e) => {
            regenerate();
            e.currentTarget.blur(); // so Space answers instead of re-clicking
          }}
          className="flex items-center h-4 leading-none gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wide hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z"
              clipRule="evenodd"
            />
          </svg>
          Restart
        </button>
        <HotkeysPanel>
          <HotkeyRow keys={["1"]} description="1st tone" />
          <HotkeyRow keys={["2"]} description="2nd tone" />
          <HotkeyRow keys={["3"]} description="3rd tone" />
          <HotkeyRow keys={["4"]} description="4th tone" />
          <HotkeyRow keys={["5", "Space"]} description="Neutral tone" />
        </HotkeysPanel>
      </div>

      <div className="relative w-full max-w-[54rem]">
        <div className="relative h-32 w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
          <div className="absolute inset-0 [mask-image:linear-gradient(to_right,transparent,black_20%,black_80%,transparent)]">
            <div
              key={round}
              className="absolute left-1/2 top-1/2 flex transition-transform duration-200 ease-out"
              style={{ transform: `translate(${-(centered + 0.5) * CELL_PX}px, -50%)` }}
            >
              {chars.map((c, i) => {
                const answered = c.tone != null && i < cursor;
                const isCursor = i === cursor;
                const flashKind = flash?.index === i ? flash.kind : null;
                const bg =
                  flashKind === "correct"
                    ? "bg-emerald-300 dark:bg-emerald-600/60"
                    : flashKind === "wrong"
                      ? "bg-red-300 dark:bg-red-600/60"
                      : isCursor
                        ? "bg-blue-100 dark:bg-blue-500/25"
                        : "";
                return (
                  <div key={i} className="flex flex-col items-center" style={{ width: CELL_PX }}>
                    <span className="h-4 whitespace-nowrap text-[10px] font-medium leading-4 text-emerald-700 dark:text-emerald-500">
                      {answered ? c.pinyin : ""}
                    </span>
                    <span
                      className={`flex h-11 w-10 items-center justify-center rounded text-3xl text-zinc-900 dark:text-zinc-100 transition-colors ${bg}`}
                    >
                      {c.ch}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* Absolutely positioned so the growing text doesn't push the
          (vertically centered) box upward as it fills in. Each read clause
          shows its characters with the translation underneath. */}
        <div className="absolute left-0 right-0 top-full mt-5 space-y-3 px-1">
          {sentences.map((sentence, i) => (
            <div key={i}>
              <p className="text-lg text-zinc-900 dark:text-zinc-100">{sentence.chinese}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{sentence.english.join(" ")}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
