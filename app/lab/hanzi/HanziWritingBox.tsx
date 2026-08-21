"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import HanziWriter from "hanzi-writer";
import { useTrackpadModeContext, TRACKPAD_CHANGED_EVENT } from "./TrackpadModeContext";
import { useGridPref } from "./GridPrefContext";

// hanzi-writer runs colors through its own color-math (for animations etc.)
// and can't parse the CSS "currentColor" keyword — passing it as a color
// option silently breaks writer creation entirely (no drawing, no hint).
// Real hex values, picked from the resolved theme, instead.
// One shared color for both the filled-in preview's strokes and the
// interactive box's trace outline — previously two different grays (a light
// one for strokes, a much darker one for the outline) that didn't match
// between the front and back of a card.
export const DARK_STROKE_COLOR = "#a1a1aa";
export const DARK_OUTLINE_COLOR = "#a1a1aa";

const TRACKPAD_MODE_KEY = "hanziTrackpadMode";
const CANVAS_SIZE = 280;

// Writing-box background — themed with plain Tailwind classes (not an inline
// style) so it responds to the site's dark-mode class automatically. The
// stroke/outline ink itself is a separate concern (see DARK_STROKE_COLOR /
// DARK_OUTLINE_COLOR above) since HanziWriter needs real hex colors, not
// CSS's "currentColor".
export const PLAIN_BACKGROUND_CLASS = "bg-white dark:bg-zinc-800";
export function gridBoxClassName(showGrid: boolean): string {
  return `hanzi-grid-layer${showGrid ? " hanzi-grid-visible" : ""}`;
}
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

export function isEditableTarget(target: EventTarget | null): boolean {
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

export default function HanziWritingBox({
  character,
  onComplete,
  showHeader = true,
  pronunciation,
  front,
  rank,
  extraHotkeys,
  showReference = true,
  traceOutline = false,
}: {
  character: string;
  onComplete?: () => void;
  showHeader?: boolean;
  pronunciation?: string;
  front?: string;
  rank?: number;
  /** Extra hotkey rows to list alongside T/S/H — e.g. the caller's own ←/→ navigation. */
  extraHotkeys?: { keys: string[]; description: string }[];
  /** The answer-key box that reveals strokes as the user gets them right — hide when the character itself must stay unrevealed. */
  showReference?: boolean;
  /** Show a faint outline of the character on the draw box itself, to trace over — for practice when the answer is already known. */
  traceOutline?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const writerRef = useRef<HanziWriter | null>(null);
  // Reference box: a second, independent HanziWriter instance that just
  // continuously loops the correct stroke-order animation, never in quiz
  // mode — purely a "here's how it's actually drawn" demo alongside the
  // interactive box.
  const referenceTargetRef = useRef<HTMLDivElement>(null);
  const referenceWriterRef = useRef<HanziWriter | null>(null);
  const [doneFlash, setDoneFlash] = useState(false);
  const doneFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mistakeFlash, setMistakeFlash] = useState(false);
  const mistakeFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [trackpadMode, setTrackpadMode] = useState(false);
  const [locked, setLocked] = useState(false);
  const trackpadModeRef = useRef(trackpadMode);
  trackpadModeRef.current = trackpadMode;
  const { registerToggleHandler } = useTrackpadModeContext();
  const { showGrid } = useGridPref();

  // Always call the latest onComplete — the writer-creation effect below is
  // keyed only on `character`, so a stale closure would otherwise capture
  // whatever onComplete reference existed the last time that effect ran.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

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

  // Relative-movement drawing state (trackpad mode)
  const virtualPos = useRef({ x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 });
  const strokeActive = useRef(false);
  // hanzi-writer's quiz() is async — its promise only resolves once the
  // character's stroke data has actually loaded, which is when virtualPos
  // gets snapped from the arbitrary canvas-center guess to the real
  // first-stroke start (below). In trackpad mode, movement events keep
  // firing the instant the pointer lock re-engages — far sooner than a
  // fresh character's data can load — so without this guard the very first
  // stroke on a new card would start from the wrong position and get
  // rejected as a mistake every time.
  const quizReadyRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const savedTrackpad = localStorage.getItem(TRACKPAD_MODE_KEY) === "1";
    setTrackpadMode(savedTrackpad);
    setTrackpadSettings(loadJSON(TRACKPAD_SETTINGS_KEY, DEFAULT_TRACKPAD_SETTINGS));
    setHelpSettings(loadJSON(HELP_SETTINGS_KEY, DEFAULT_HELP_SETTINGS));
    // Every new card (and every redo, via its remount key) mounts a fresh
    // instance of this component, which drops the actual browser-level
    // pointer lock even though trackpad mode itself is still "on" per
    // localStorage — re-request it here instead of waiting for the user to
    // click back into the box (which also meant it silently did nothing if
    // their mouse happened to be outside the box when the new card loaded).
    // Still only fires from a mount caused by a genuine gesture (grading,
    // Show Answer, or the R redo hotkey), so it stays within the Pointer
    // Lock API's user-activation requirement.
    if (savedTrackpad && targetRef.current && document.pointerLockElement !== targetRef.current) {
      try {
        targetRef.current.requestPointerLock();
      } catch {
        // Some browsers may refuse this if activation has already expired —
        // falls back to the existing manual click-to-toggle behavior.
      }
    }
  }, []);

  // Turning trackpad mode on immediately locks the pointer — no click into
  // the box needed first. This only works because setTrackpadModeValue is
  // always called directly from a genuine user gesture (a click or a
  // keydown), which is what the Pointer Lock API requires; it's never called
  // from an effect or timer.
  function setTrackpadModeValue(next: boolean) {
    setTrackpadMode(next);
    localStorage.setItem(TRACKPAD_MODE_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(TRACKPAD_CHANGED_EVENT));
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

  // Lets the review header's trackpad toggle button trigger this box's own
  // toggle — necessary because only the box (which owns the target element)
  // can issue the actual pointer-lock request/release, and that must happen
  // synchronously inside the header button's click for the Pointer Lock
  // API's user-activation rule.
  useEffect(() => {
    registerToggleHandler(toggleTrackpadMode);
    return () => registerToggleHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // T toggles trackpad mode, Esc exits it, S toggles the background
  // character, H shows a hint. Attached once (not re-subscribed per render),
  // so all the handlers above read the latest state via refs rather than
  // closed-over values — otherwise this would act on stale state after the
  // first render.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;

      if (e.key === "Escape") {
        if (trackpadModeRef.current) setTrackpadModeValue(false);
        return;
      }
      // "T" is handled once, globally, by TrackpadModeProvider — it needs
      // to work even while this box isn't mounted (e.g. viewing the
      // revealed static preview), and handling it here too would
      // double-toggle on every press whenever a box is mounted.
      if ((e.key === "s" || e.key === "S") && showReference) {
        setShowOutline(!helpSettingsRef.current.showOutline);
        return;
      }
      if (e.key === "h" || e.key === "H") {
        triggerHint();
        return;
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
        // Deliberately NOT disabling trackpad mode here. Losing the OS-level
        // lock happens for lots of benign, non-"user wants out" reasons —
        // this box unmounting (card change, reveal, redo), a re-lock attempt
        // landing just outside the activation window, momentary focus loss —
        // and treating every one of those as an exit was exactly what kept
        // silently flipping the preference off. Turning trackpad mode off is
        // now only ever a direct, manual action: the Escape keydown handler
        // below, or the T hotkey / header toggle button (both call
        // setTrackpadModeValue directly, never from here).
      }
    }
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    return () => {
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      // Deliberately not calling exitPointerLock() here: on every card
      // change / redo, this component remounts and (if trackpad mode is
      // still on) immediately re-requests the lock in its mount effect.
      // Explicitly releasing first would force a real unlock->relock cycle,
      // and the resulting "unlocked" pointerlockchange would be seen by the
      // *new* instance's listener as the user having exited, turning
      // trackpad mode back off right after it was restored. The browser
      // already releases the lock on its own once this element leaves the
      // DOM, so no manual release is needed for the case where nothing
      // re-requests it.
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
    // The very first mousemove event delivered right after a Pointer Lock
    // engages is a known browser quirk — its movementX/movementY can be a
    // large, bogus spike (observed to reflect stuff like the cursor's
    // pre-lock position rather than an actual relative delta), instead of
    // the small delta a real trackpad nudge would produce. Applied
    // literally, that one event can fling the virtual pen far from the
    // correct starting point in a single step — a stroke that then fails
    // to match anything, immediately, every time, right as the pen was
    // otherwise correctly primed at the real expected start. Discard just
    // that first event's delta; every event after it behaves normally.
    let firstMove = true;

    function handleMouseMove(e: MouseEvent) {
      if (firstMove) {
        firstMove = false;
        return;
      }
      // Ignore movement until the quiz has actually finished loading this
      // character's stroke data — starting a stroke any earlier would use
      // the placeholder canvas-center position instead of the real expected
      // start, getting flagged as a mistake. The trackpad's own relative
      // motion isn't lost, just not drawn with yet; the pen simply starts
      // moving for real the moment loading finishes.
      if (!quizReadyRef.current) return;
      const quiz = getInternalQuiz(writerRef.current);
      if (!quiz) return;

      const { sensitivity, idleMs } = trackpadSettingsRef.current;
      // A hard cap on the raw per-event delta, on top of the sensitivity
      // multiplier — defends against any other stray oversized event (not
      // just the known first-event spike above) teleporting the pen instead
      // of nudging it, which would otherwise read as a clean straight jump
      // through the middle of the canvas rather than a real drawn stroke.
      const MAX_DELTA = 40;
      const dx = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.movementX));
      const dy = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.movementY));
      virtualPos.current = {
        x: Math.max(0, Math.min(CANVAS_SIZE, virtualPos.current.x + dx * sensitivity)),
        y: Math.max(0, Math.min(CANVAS_SIZE, virtualPos.current.y + dy * sensitivity)),
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
    setDoneFlash(false);
    setLoadError(false);
    strokeActive.current = false;
    quizReadyRef.current = false;
    virtualPos.current = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };

    resetReferenceStrokes(referenceWriterRef.current);

    // Not trackpadModeRef here — on a fresh mount, this runs in the same
    // initial effect flush as the mount effect that restores trackpad mode
    // from localStorage (via setTrackpadMode), and that state update isn't
    // reflected into the ref (which only syncs during render) until the
    // *next* render, which happens after this flush completes. Since
    // startQuiz only ever runs once per character, reading the ref here
    // meant the leniency boost silently never applied on any card's first
    // (only) quiz setup while trackpad mode was on — exactly when it's
    // needed most, since trackpad-driven strokes are jerkier. Reading
    // localStorage directly matches the same source of truth synchronously.
    const isTrackpad = localStorage.getItem(TRACKPAD_MODE_KEY) === "1";
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
          flashDone();
          onCompleteRef.current?.();
        },
      })
      ?.then(() => {
        // Once the quiz has actually started (character data may still have
        // been loading), snap the virtual pen to the real first-stroke start
        // rather than the arbitrary center-of-canvas guess.
        const start = expectedNextStrokeStart(writer);
        if (start) virtualPos.current = start;
        quizReadyRef.current = true;
        // hanzi-writer's quiz always reveals its own clean stroke render
        // here regardless of showCharacter. When there's a separate
        // reference box (showReference), that box is the answer key, so
        // suppress the official render here and keep this box showing only
        // the user's own pixels. Without a reference box, there's nowhere
        // else to see the correct shape, so let the official stroke overlay
        // the user's own ink instead — confirms accuracy stroke by stroke.
        // On mobile there's only one combined box, so the official stroke
        // always renders through regardless, same as the original design.
        if (!isMobileRef.current && showReference) hideOfficialStrokes(writer);
      });
  }

  useEffect(() => {
    if (!targetRef.current || !character) return;

    if (!writerRef.current) {
      writerRef.current = HanziWriter.create(targetRef.current, character, {
        width: 280,
        height: 280,
        padding: 12,
        // Desktop: the left box only shows the user's own drawn pixels, no
        // static character reveal (the right box is the answer key instead)
        // — but `traceOutline` can still show a faint trace-over guide when
        // the answer is already known (e.g. the back-side redraw). Mobile:
        // one combined box, so the outline and official strokes are allowed
        // to show through as usual — unless the answer key is suppressed
        // entirely (showReference=false), in which case the outline would be
        // the only way to see the character early.
        showOutline: isMobileRef.current
          ? traceOutline || (showReference && helpSettingsRef.current.showOutline)
          : traceOutline,
        showCharacter: false,
        ...(isDark ? { outlineColor: DARK_OUTLINE_COLOR } : {}),
        // Distinct from the reference box's gray so it's unmistakably the
        // user's own ink, never the hidden "official" stroke layer. Left
        // out entirely (not just `undefined`) on mobile so hanzi-writer's
        // own default color option applies instead.
        ...(isMobileRef.current ? {} : { drawingColor: "#2563eb" }),
        onLoadCharDataError: () => setLoadError(true),
      });
    } else {
      writerRef.current.setCharacter(character).catch(() => setLoadError(true));
    }

    startQuiz(writerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character]);

  // The reference box is the answer key: it stays blank and only reveals
  // each stroke, permanently, the moment the user draws that stroke correctly
  // in the interactive box (see the onCorrectStroke handler in startQuiz).
  // Not used at all on mobile, where there's just the one combined box.
  useEffect(() => {
    if (isMobile || !showReference) return;
    if (!referenceTargetRef.current || !character) return;

    if (!referenceWriterRef.current) {
      referenceWriterRef.current = HanziWriter.create(referenceTargetRef.current, character, {
        width: 280,
        height: 280,
        padding: 12,
        showOutline: helpSettingsRef.current.showOutline,
        showCharacter: false,
        ...(isDark ? { strokeColor: DARK_STROKE_COLOR, outlineColor: DARK_OUTLINE_COLOR } : {}),
      });
      referenceWriterRef.current.hideCharacter({ duration: 0 })?.then(() => {
        resetReferenceStrokes(referenceWriterRef.current);
      });
    } else {
      referenceWriterRef.current.setCharacter(character).then(() => {
        resetReferenceStrokes(referenceWriterRef.current);
      });
    }
  }, [character, isMobile, showReference]);

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

  return (
    <div className="space-y-4">
      <div className="max-w-4xl mx-auto text-center space-y-4">
        {showHeader && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr] gap-6">
            <div className="hidden xl:block" />
            <div>
              <p className="text-sm text-zinc-500">{pronunciation}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">{front}</p>
              {rank != null && <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5">rank {rank}</p>}
            </div>
            <div className="hidden xl:block" />
          </div>
        )}

        <div className={`grid grid-cols-1 items-start gap-6 ${showHeader ? "xl:grid-cols-[1fr_auto_1fr]" : ""}`}>
          {showHeader && <div className="hidden xl:block" />}

          <div className="flex justify-center">
          <div className="flex flex-wrap items-start justify-center gap-6">
            <div className="space-y-1.5">
              <div
                ref={wrapperRef}
                className={`relative overflow-hidden touch-none rounded-xl border shrink-0 transition-shadow duration-300 ${gridBoxClassName(showGrid)} ${PLAIN_BACKGROUND_CLASS} ${
                  doneFlash
                    ? "border-emerald-400 ring-4 ring-emerald-500/60 shadow-[0_0_25px_6px_rgba(16,185,129,0.55)]"
                    : mistakeFlash
                    ? "border-red-400 ring-4 ring-red-500/50 shadow-[0_0_25px_6px_rgba(239,68,68,0.45)]"
                    : trackpadMode
                    ? "cursor-none border-blue-400 ring-4 ring-blue-500/60 shadow-[0_0_25px_6px_rgba(59,130,246,0.55)]"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
                style={{ width: 280, height: 280 }}
              >
                <div ref={targetRef} className="absolute inset-0" style={{ width: 280, height: 280 }} />
              </div>
            </div>

            {showReference && (
              <div className="hidden md:block space-y-1.5">
                <div
                  className={`relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 shrink-0 ${gridBoxClassName(showGrid)} ${PLAIN_BACKGROUND_CLASS}`}
                  style={{ width: 280, height: 280 }}
                >
                  <div ref={referenceTargetRef} className="absolute inset-0" style={{ width: 280, height: 280 }} />
                </div>
              </div>
            )}
          </div>
          </div>

          {showHeader && (
            <div className="hidden xl:block justify-self-start w-44 text-left space-y-1.5">
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">Hotkeys</p>
              <div className="space-y-1.5 pt-1">
                <HotkeyRow keys={["T"]} description="Trackpad mode" />
                <HotkeyRow keys={["S"]} description="Background character" />
                <HotkeyRow keys={["H"]} description="Show next hint" />
                {extraHotkeys?.map((row) => (
                  <HotkeyRow key={row.description} keys={row.keys} description={row.description} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="md:hidden flex flex-col items-center gap-2">
          <button
            onClick={triggerHint}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"
          >
            Hint
          </button>
          {showReference && (
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
          )}
        </div>

        {loadError && (
          <div className="flex items-center justify-center gap-3 text-xs text-zinc-500">
            <span className="text-red-500">Couldn&apos;t load stroke data for this character</span>
          </div>
        )}
      </div>
    </div>
  );
}
