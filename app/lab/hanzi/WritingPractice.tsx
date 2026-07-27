"use client";

import { useEffect, useRef, useState } from "react";
import HanziWriter from "hanzi-writer";
import type { HanziCard } from "./CharacterGrid";

function pickRandom(cards: HanziCard[], exclude?: string): HanziCard | undefined {
  if (cards.length === 0) return undefined;
  if (cards.length === 1) return cards[0];
  let choice: HanziCard;
  do {
    choice = cards[Math.floor(Math.random() * cards.length)];
  } while (choice.character === exclude);
  return choice;
}

const TRACKPAD_MODE_KEY = "hanziTrackpadMode";
const CANVAS_SIZE = 280;
// hanzi-writer's own built-in defaults (confirmed from its source) — used as
// our baseline rather than guessed numbers.
const BASE_LENIENCY = 1;
const BASE_DISTANCE_THRESHOLD = 350;
// Trackpad-driven input (both click-drag and relative-movement mode) tends to
// be jerkier than touch/mouse-on-desk input, so matching is loosened a bit
// whenever trackpad mode is active, on top of whatever the user's help
// settings already specify — not itself a user-facing setting.
const TRACKPAD_LENIENCY_BOOST = 0.6;
const TRACKPAD_DISTANCE_BOOST = 150;

interface TrackpadSettings {
  /** How far the virtual pen moves per unit of raw trackpad movement. */
  sensitivity: number;
  /** Pause (ms) with no movement before a stroke is considered finished. */
  idleMs: number;
}
const DEFAULT_TRACKPAD_SETTINGS: TrackpadSettings = { sensitivity: 0.5, idleMs: 100 };
const TRACKPAD_SETTINGS_KEY = "hanziTrackpadSettings";

interface HelpSettings {
  /** The faint full-character outline shown behind the reference box's revealed strokes. */
  showOutline: boolean;
}
const DEFAULT_HELP_SETTINGS: HelpSettings = { showOutline: true };
const HELP_SETTINGS_KEY = "hanziHelpSettings";
// Always highlight the current stroke (hanzi-writer's blue hint) after this
// many mistakes in a row — no longer user-configurable.
const HINT_AFTER_MISSES = 3;

// HanziWriter has no public API for feeding it synthetic stroke points (only
// real DOM pointer events). Its internal Quiz instance does have the methods
// we need, so we reach into the underscore-prefixed (conventionally private,
// not actually enforced) `_quiz` field. This is inherently a bit fragile
// against future hanzi-writer versions changing their internals.
interface InternalQuiz {
  _currentStrokeIndex: number;
  startUserStroke(point: { x: number; y: number }): void;
  continueUserStroke(point: { x: number; y: number }): void;
  endUserStroke(): void;
  // Set the moment a stroke starts, cleared right after the correct/incorrect
  // check runs — read from onCorrectStroke, so it's still populated there.
  _userStroke?: { id: string };
}
interface InternalStroke {
  getStartingPoint(): { x: number; y: number };
}
interface InternalCharacter {
  strokes: InternalStroke[];
}
interface InternalPositioner {
  xOffset: number;
  yOffset: number;
  scale: number;
  height: number;
}
interface InternalRenderState {
  updateState(changes: unknown): void;
  cancelMutations(scopes: string[]): void;
}
interface InternalWriterFields {
  _quiz?: InternalQuiz;
  _character?: InternalCharacter;
  _positioner?: InternalPositioner;
  _renderState?: InternalRenderState;
}

function internals(writer: HanziWriter | null): InternalWriterFields {
  return (writer as unknown as InternalWriterFields | null) ?? {};
}

function getInternalQuiz(writer: HanziWriter | null): InternalQuiz | undefined {
  return internals(writer)._quiz;
}

// The point where the user is *expected* to start their next stroke, mapped
// from hanzi-writer's internal character-grid coordinates into the same
// external (box-relative pixel) space our synthetic points use — the exact
// inverse of Positioner.convertExternalPoint's formula (read from hanzi-
// writer's source, since this mapping isn't part of its public API/types).
function expectedNextStrokeStart(writer: HanziWriter | null): { x: number; y: number } | undefined {
  const { _quiz, _character, _positioner } = internals(writer);
  if (!_quiz || !_character || !_positioner) return undefined;
  const stroke = _character.strokes[_quiz._currentStrokeIndex];
  if (!stroke) return undefined;
  const internal = stroke.getStartingPoint();
  const { xOffset, yOffset, scale, height } = _positioner;
  return {
    x: internal.x * scale + xOffset,
    y: height - yOffset - internal.y * scale,
  };
}

// The reference box doesn't use hanzi-writer's quiz or animation modes — it
// just needs to permanently reveal one stroke at a time as the user gets
// each one right in the interactive box. There's no public API for "show
// exactly strokes 0..N", so this reaches into the same internal render state
// hanzi-writer's own quiz/animation code mutates (see showStroke/showCharacter
// in hanzi-writer's source): the character group's overall opacity gates
// visibility, while each stroke's own opacity toggles it individually.
function resetReferenceStrokes(writer: HanziWriter | null) {
  const { _renderState, _character } = internals(writer);
  if (!_renderState || !_character) return;
  const strokes: Record<number, { opacity: number }> = {};
  for (let i = 0; i < _character.strokes.length; i++) strokes[i] = { opacity: 0 };
  _renderState.updateState({ character: { main: { opacity: 1, strokes } } });
}

function revealReferenceStroke(writer: HanziWriter | null, strokeNum: number) {
  const { _renderState } = internals(writer);
  if (!_renderState) return;
  _renderState.updateState({ character: { main: { strokes: { [strokeNum]: { opacity: 1 } } } } });
}

// hanzi-writer's quiz always does two things we don't want in the interactive
// box: it fades the user's own drawn stroke back out (drawingFadeDuration,
// even on a correct stroke), and it swaps in its own clean "official" stroke
// render in its place. We want the opposite — keep exactly the pixels the
// user drew, permanently, and never show the official glyph there at all.
// Both behaviors are internal (no public option disables them), so this
// reaches into the same render state again: canceling the in-flight fade-out
// mutation for that specific user stroke and forcing its opacity back to 1.
function persistUserStroke(writer: HanziWriter | null) {
  const { _quiz, _renderState } = internals(writer);
  const id = _quiz?._userStroke?.id;
  if (!id || !_renderState) return;
  _renderState.cancelMutations([`userStrokes.${id}`]);
  _renderState.updateState({ userStrokes: { [id]: { opacity: 1 } } });
}

// Suppresses hanzi-writer's own "official stroke" reveal in the interactive
// box permanently (it forces this on at the start of every quiz regardless
// of showCharacter) — the left box should only ever show the user's pixels.
function hideOfficialStrokes(writer: HanziWriter | null) {
  const { _renderState } = internals(writer);
  _renderState?.updateState({ character: { main: { opacity: 0 } } });
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? { ...fallback, ...JSON.parse(saved) } : fallback;
  } catch {
    return fallback;
  }
}

function HotkeyRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
      <span>{description}</span>
      <span className="flex items-center gap-1 shrink-0">
        {keys.map((key) => (
          <kbd
            key={key}
            className="rounded border border-zinc-300 dark:border-zinc-600 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:text-zinc-300"
          >
            {key}
          </kbd>
        ))}
      </span>
    </div>
  );
}

export default function WritingPractice({ cards }: { cards: HanziCard[] }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const writerRef = useRef<HanziWriter | null>(null);
  // Reference box: a second, independent HanziWriter instance that just
  // continuously loops the correct stroke-order animation, never in quiz
  // mode — purely a "here's how it's actually drawn" demo alongside the
  // interactive box.
  const referenceTargetRef = useRef<HTMLDivElement>(null);
  const referenceWriterRef = useRef<HanziWriter | null>(null);
  const [current, setCurrent] = useState<HanziCard | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [doneFlash, setDoneFlash] = useState(false);
  const doneFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mistakeFlash, setMistakeFlash] = useState(false);
  const mistakeFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [trackpadMode, setTrackpadMode] = useState(false);
  const [locked, setLocked] = useState(false);
  const trackpadModeRef = useRef(trackpadMode);
  trackpadModeRef.current = trackpadMode;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  // On phones there's no room for a separate reference box (and precise
  // pixel-matching is less the point there anyway) — fall back to a single
  // combined box: the outline shows through and correct strokes get drawn in
  // directly, like the very first version of this tool.
  const [isMobile, setIsMobile] = useState(false);
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Trackpad-specific mechanics (only meaningful while trackpad mode is on)
  const [trackpadSettings, setTrackpadSettings] = useState<TrackpadSettings>(DEFAULT_TRACKPAD_SETTINGS);
  const trackpadSettingsRef = useRef(trackpadSettings);
  trackpadSettingsRef.current = trackpadSettings;

  // General help/hint settings — apply regardless of input mode
  const [helpSettings, setHelpSettings] = useState<HelpSettings>(DEFAULT_HELP_SETTINGS);
  const helpSettingsRef = useRef(helpSettings);
  helpSettingsRef.current = helpSettings;

  function updateHelpSetting<K extends keyof HelpSettings>(key: K, value: HelpSettings[K]) {
    setHelpSettings((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(HELP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }

  // Toggling the outline updates the already-mounted reference writer
  // immediately, rather than only taking effect on the next character.
  function setShowOutline(value: boolean) {
    updateHelpSetting("showOutline", value);
    // Desktop: the outline lives on the reference (answer key) box. Mobile:
    // there's only the one combined box, so it lives on the writer directly.
    const writer = isMobileRef.current ? writerRef.current : referenceWriterRef.current;
    if (value) writer?.showOutline();
    else writer?.hideOutline();
  }


  // Character navigation history (so ArrowLeft can go back, not just re-roll)
  const historyRef = useRef<HanziCard[]>([]);
  const historyIndexRef = useRef(-1);

  // Relative-movement drawing state (trackpad mode)
  const virtualPos = useRef({ x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 });
  const strokeActive = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTrackpadMode(localStorage.getItem(TRACKPAD_MODE_KEY) === "1");
    setTrackpadSettings(loadJSON(TRACKPAD_SETTINGS_KEY, DEFAULT_TRACKPAD_SETTINGS));
    setHelpSettings(loadJSON(HELP_SETTINGS_KEY, DEFAULT_HELP_SETTINGS));
  }, []);

  // Turning trackpad mode on immediately locks the pointer — no click into
  // the box needed first. This only works because setTrackpadModeValue is
  // always called directly from a genuine user gesture (a click or a
  // keydown), which is what the Pointer Lock API requires; it's never called
  // from an effect or timer.
  function setTrackpadModeValue(next: boolean) {
    setTrackpadMode(next);
    localStorage.setItem(TRACKPAD_MODE_KEY, next ? "1" : "0");
    if (next) {
      if (document.pointerLockElement !== targetRef.current) {
        targetRef.current?.requestPointerLock();
      }
    } else if (document.pointerLockElement === targetRef.current) {
      document.exitPointerLock();
    }
  }

  function toggleTrackpadMode() {
    setTrackpadModeValue(!trackpadModeRef.current);
  }

  function goNext() {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      setCurrent(historyRef.current[historyIndexRef.current]);
      return;
    }
    const exclude = historyRef.current[historyIndexRef.current]?.character;
    const nextCard = pickRandom(cardsRef.current, exclude);
    if (!nextCard) return;
    historyRef.current = [...historyRef.current, nextCard];
    historyIndexRef.current += 1;
    setCurrent(nextCard);
  }

  function goPrevious() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    setCurrent(historyRef.current[historyIndexRef.current]);
  }

  // Global shortcuts: T toggles trackpad mode, Esc exits it, Left/Right
  // navigate cards. Attached once (not re-subscribed per render), so all
  // the handlers above read the latest state via refs rather than closed-
  // over values — otherwise this would act on stale state after the first
  // render.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;

      if (e.key === "Escape") {
        if (trackpadModeRef.current) setTrackpadModeValue(false);
        return;
      }
      if (e.key === "t" || e.key === "T") {
        toggleTrackpadMode();
        return;
      }
      if (e.key === "s" || e.key === "S") {
        setShowOutline(!helpSettingsRef.current.showOutline);
        return;
      }
      if (e.key === "h" || e.key === "H") {
        triggerHint();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevious();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function endCurrentStroke() {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (!strokeActive.current) return;
    strokeActive.current = false;
    getInternalQuiz(writerRef.current)?.endUserStroke();
    // Simulate the user physically lifting their finger and repositioning it
    // over the trackpad before the next stroke: snap the virtual pen to
    // wherever the (now-current, post-endUserStroke) expected stroke actually
    // starts, rather than leaving it wherever the last stroke happened to
    // drift to. Falls back to staying put if data isn't available yet.
    const nextStart = expectedNextStrokeStart(writerRef.current);
    if (nextStart) virtualPos.current = nextStart;
  }

  // Pointer lock lifecycle. A native (non-React-synthetic) capture-phase
  // listener on the *wrapper* intercepts mousedown before it can reach
  // HanziWriter's own bubble-phase mousedown listener on the target div —
  // otherwise a real click-drag stroke and our synthetic one would both
  // start at once. stopPropagation() during capture, on an ancestor of the
  // target, prevents the event from ever reaching the target at all. This is
  // now mostly a fallback (lock is normally requested the instant trackpad
  // mode is toggled on), kept in case that initial request ever fails.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !trackpadMode) return;

    function engage(e: MouseEvent) {
      e.stopPropagation();
      e.preventDefault();
      if (document.pointerLockElement !== targetRef.current) {
        targetRef.current?.requestPointerLock();
      }
    }

    wrapper.addEventListener("mousedown", engage, { capture: true });
    return () => wrapper.removeEventListener("mousedown", engage, { capture: true });
  }, [trackpadMode]);

  useEffect(() => {
    function handlePointerLockChange() {
      const isLocked = document.pointerLockElement === targetRef.current;
      setLocked(isLocked);
      if (!isLocked) {
        endCurrentStroke();
        // Releasing lock (Esc, tab switch, etc.) always exits the mode
        // entirely, matching how Esc was defined to behave before.
        setTrackpadModeValue(false);
      }
    }
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    return () => {
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      if (document.pointerLockElement === targetRef.current) document.exitPointerLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While locked: every movement delta always draws (no press needed).
  // Position is relative-only (no absolute anchor), so it's clamped to the
  // canvas bounds and reset to center at the start of each new character —
  // absolute placement may drift, but each stroke's relative shape/direction
  // is what actually gets graded.
  useEffect(() => {
    if (!locked) return;

    function handleMouseMove(e: MouseEvent) {
      const quiz = getInternalQuiz(writerRef.current);
      if (!quiz) return;

      const { sensitivity, idleMs } = trackpadSettingsRef.current;
      virtualPos.current = {
        x: Math.max(0, Math.min(CANVAS_SIZE, virtualPos.current.x + e.movementX * sensitivity)),
        y: Math.max(0, Math.min(CANVAS_SIZE, virtualPos.current.y + e.movementY * sensitivity)),
      };

      if (!strokeActive.current) {
        strokeActive.current = true;
        quiz.startUserStroke(virtualPos.current);
      } else {
        quiz.continueUserStroke(virtualPos.current);
      }

      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(endCurrentStroke, idleMs);
    }

    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  // pick a starting character once cards are available, seeding history
  useEffect(() => {
    setCurrent((prev) => {
      if (prev) return prev;
      const first = pickRandom(cards);
      if (first) {
        historyRef.current = [first];
        historyIndexRef.current = 0;
      }
      return first;
    });
  }, [cards]);

  function flashMistake() {
    if (mistakeFlashTimer.current) clearTimeout(mistakeFlashTimer.current);
    setMistakeFlash(true);
    mistakeFlashTimer.current = setTimeout(() => setMistakeFlash(false), 400);
  }

  function flashDone() {
    if (doneFlashTimer.current) clearTimeout(doneFlashTimer.current);
    setDoneFlash(true);
    doneFlashTimer.current = setTimeout(() => setDoneFlash(false), 600);
  }

  function startQuiz(writer: HanziWriter) {
    setDone(false);
    setDoneFlash(false);
    setLoadError(false);
    strokeActive.current = false;
    virtualPos.current = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };

    resetReferenceStrokes(referenceWriterRef.current);

    const isTrackpad = trackpadModeRef.current;
    writer
      .quiz({
        leniency: BASE_LENIENCY + (isTrackpad ? TRACKPAD_LENIENCY_BOOST : 0),
        averageDistanceThreshold: BASE_DISTANCE_THRESHOLD + (isTrackpad ? TRACKPAD_DISTANCE_BOOST : 0),
        showHintAfterMisses: HINT_AFTER_MISSES,
        // Suppress hanzi-writer's own default full-character flash on
        // completion (in highlightColor, a blue-purple) — we show our own
        // green ring flash around the box instead (see flashDone).
        highlightOnComplete: false,
        onMistake: () => flashMistake(),
        onCorrectStroke: (data: { strokeNum: number }) => {
          if (!isMobileRef.current) {
            persistUserStroke(writer);
            revealReferenceStroke(referenceWriterRef.current, data.strokeNum);
          }
        },
        onComplete: () => {
          setDone(true);
          flashDone();
        },
      })
      ?.then(() => {
        // Once the quiz has actually started (character data may still have
        // been loading), snap the virtual pen to the real first-stroke start
        // rather than the arbitrary center-of-canvas guess.
        const start = expectedNextStrokeStart(writer);
        if (start) virtualPos.current = start;
        // hanzi-writer's quiz always reveals its own clean stroke render
        // here regardless of showCharacter — suppress it every time a quiz
        // (re)starts so the left box only ever shows the user's own pixels.
        // On mobile there's only one box, so the opposite applies: let the
        // official stroke render through, same as the original single-box design.
        if (!isMobileRef.current) hideOfficialStrokes(writer);
      });
  }

  useEffect(() => {
    if (!targetRef.current || !current) return;

    if (!writerRef.current) {
      writerRef.current = HanziWriter.create(targetRef.current, current.character, {
        width: 280,
        height: 280,
        padding: 12,
        // Desktop: the left box only shows the user's own drawn pixels — no
        // outline trace and no static character reveal (the right box is the
        // answer key instead). Mobile: one combined box, so the outline and
        // official strokes are allowed to show through as usual.
        showOutline: isMobileRef.current ? helpSettingsRef.current.showOutline : false,
        showCharacter: false,
        // Distinct from the reference box's gray so it's unmistakably the
        // user's own ink, never the hidden "official" stroke layer. Left
        // out entirely (not just `undefined`) on mobile so hanzi-writer's
        // own default color option applies instead.
        ...(isMobileRef.current ? {} : { drawingColor: "#2563eb" }),
        onLoadCharDataError: () => setLoadError(true),
      });
    } else {
      writerRef.current.setCharacter(current.character).catch(() => setLoadError(true));
    }

    startQuiz(writerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // The reference box is the answer key: it stays blank and only reveals
  // each stroke, permanently, the moment the user draws that stroke correctly
  // in the interactive box (see the onCorrectStroke handler in startQuiz).
  // Not used at all on mobile, where there's just the one combined box.
  useEffect(() => {
    if (isMobile) return;
    if (!referenceTargetRef.current || !current) return;

    if (!referenceWriterRef.current) {
      referenceWriterRef.current = HanziWriter.create(referenceTargetRef.current, current.character, {
        width: 280,
        height: 280,
        padding: 12,
        showOutline: helpSettingsRef.current.showOutline,
        showCharacter: false,
      });
      referenceWriterRef.current.hideCharacter({ duration: 0 })?.then(() => {
        resetReferenceStrokes(referenceWriterRef.current);
      });
    } else {
      referenceWriterRef.current.setCharacter(current.character).then(() => {
        resetReferenceStrokes(referenceWriterRef.current);
      });
    }
  }, [current, isMobile]);

  // Manually flash the hint stroke for whatever stroke is currently expected,
  // independent of the "N mistakes before hint" auto-trigger.
  function triggerHint() {
    const writer = writerRef.current;
    const { _quiz, _character } = internals(writer);
    if (!writer || !_quiz || !_character) return;
    // Once the quiz is done, _currentStrokeIndex sits one past the last
    // stroke — highlightStroke would throw trying to highlight a
    // nonexistent stroke, so there's simply no hint left to show.
    if (_quiz._currentStrokeIndex >= _character.strokes.length) return;
    writer.highlightStroke(_quiz._currentStrokeIndex);
  }

  if (!current) {
    return <p className="text-sm text-zinc-500">No cards to practice with yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="max-w-4xl mx-auto text-center space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr] gap-6">
          <div className="hidden xl:block" />
          <div>
            <p className="text-sm text-zinc-500">{current.pronunciation}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{current.front}</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5">rank {current.rank}</p>
          </div>
          <div className="hidden xl:block" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr] items-start gap-6">
          <div className="hidden xl:block" />

          <div className="flex flex-wrap items-start justify-center gap-6">
            <div className="space-y-1.5">
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">Draw</p>
              <div ref={wrapperRef} style={{ width: 280, height: 280 }}>
                <div
                  ref={targetRef}
                  className={`relative touch-none rounded-xl border bg-white transition-shadow duration-300 ${
                    doneFlash
                      ? "border-emerald-400 ring-4 ring-emerald-500/60 shadow-[0_0_25px_6px_rgba(16,185,129,0.55)]"
                      : mistakeFlash
                      ? "border-red-400 ring-4 ring-red-500/50 shadow-[0_0_25px_6px_rgba(239,68,68,0.45)]"
                      : trackpadMode
                      ? "cursor-none border-blue-400 ring-4 ring-blue-500/60 shadow-[0_0_25px_6px_rgba(59,130,246,0.55)]"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                  style={{ width: 280, height: 280 }}
                />
              </div>
            </div>

            <div className="hidden md:block space-y-1.5">
              <p className="text-[11px] text-transparent select-none uppercase tracking-wide">Draw</p>
              <div
                ref={referenceTargetRef}
                className="relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white"
                style={{ width: 280, height: 280 }}
              />
            </div>
          </div>

          <div className="hidden xl:block justify-self-start w-44 text-left space-y-1.5">
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">Hotkeys</p>
            <div className="space-y-1.5 pt-1">
              <HotkeyRow keys={["T"]} description="Trackpad mode" />
              <HotkeyRow keys={["S"]} description="Background character" />
              <HotkeyRow keys={["H"]} description="Show next hint" />
              <HotkeyRow keys={["←", "→"]} description="Previous / next" />
            </div>
          </div>
        </div>

        <div className="md:hidden flex flex-col items-center gap-2">
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={goPrevious}
              className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"
            >
              ← Previous
            </button>
            <button
              onClick={goNext}
              className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"
            >
              Next →
            </button>
          </div>
          <button
            onClick={triggerHint}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"
          >
            Hint
          </button>
          <button
            onClick={() => setShowOutline(!helpSettings.showOutline)}
            aria-pressed={helpSettings.showOutline}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              helpSettings.showOutline
                ? "border-zinc-700 dark:border-zinc-300 bg-gradient-to-b from-zinc-700 to-zinc-900 dark:from-zinc-100 dark:to-zinc-300 text-white dark:text-zinc-900"
                : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
            }`}
          >
            Background character
          </button>
        </div>

        <div className="flex items-center justify-center gap-3 text-xs text-zinc-500 h-4">
          {loadError && <span className="text-red-500">Couldn&apos;t load stroke data for this character</span>}
        </div>

        {trackpadMode && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg px-3 py-2">
            {locked
              ? "Just move your finger on the trackpad to draw — no click needed. Pause briefly between strokes."
              : "Locking in…"}{" "}
            Press{" "}
            <kbd className="rounded border border-zinc-300 dark:border-zinc-600 px-1 py-0.5 text-[10px] font-mono">
              Esc
            </kbd>{" "}
            to exit.
          </p>
        )}
      </div>
    </div>
  );
}
