"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Must match HanziWritingBox.tsx's own TRACKPAD_MODE_KEY — this is the same
// persisted preference, just also readable/writable from the review header.
const TRACKPAD_MODE_KEY = "hanziTrackpadMode";
// Fired by anything that writes TRACKPAD_MODE_KEY (here, and
// HanziWritingBox.tsx's setTrackpadModeValue) so the provider can re-read
// localStorage — see the comment on TrackpadModeProvider below for why this
// replaced a push-based "boxes report their state" model.
export const TRACKPAD_CHANGED_EVENT = "hanzi-trackpad-changed";

type Ctx = {
  trackpadMode: boolean;
  // Flips trackpad mode. If a HanziWritingBox is currently mounted and
  // registered, delegates to its own toggle so the actual pointer-lock
  // request/release happens synchronously inside this click (required by
  // the Pointer Lock API's user-activation rule, and only the box — which
  // owns the target element — can do that). With no box mounted (e.g. the
  // revealed static preview), just flips the persisted preference so
  // whatever box mounts next honors it.
  toggle: () => void;
  registerToggleHandler: (fn: (() => void) | null) => void;
};

const defaultCtx: Ctx = {
  trackpadMode: false,
  toggle: () => {},
  registerToggleHandler: () => {},
};

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

const TrackpadModeContext = createContext<Ctx>(defaultCtx);

export function TrackpadModeProvider({ children }: { children: React.ReactNode }) {
  // Sourced from localStorage continuously (mount + the change event) rather
  // than pushed in by whichever HanziWritingBox happens to be mounted. The
  // previous push model tied the header's displayed on/off state to box
  // mount lifecycle — reveal swaps the box for a static preview that never
  // reports anything, so the display could linger on a stale value (or the
  // initial `false` default) instead of reflecting the real preference.
  // Reading localStorage directly means "no box mounted" just keeps showing
  // whatever the preference already says, which is what should happen.
  // Every new review session starts with trackpad mode off, regardless of
  // whether a previous session left it on — it's meant as an in-session
  // convenience once you turn it on, not a sticky global default. This
  // provider already remounts fresh per deck (keyed on selectedDeck in
  // FlashcardTab), so "on mount" here means "session start": force the
  // persisted flag back to off. This has to happen in a useState lazy
  // initializer (runs synchronously during render), not a useEffect —
  // effects run child-first within a commit, so by the time this Provider's
  // own effect would run, the first card's HanziWritingBox had *already*
  // run its own mount effect and read the still-stale "1", requesting a
  // real pointer lock and boosted leniency before the reset ever landed.
  // The display correctly showed off, but trackpad was actually active
  // underneath. A lazy initializer runs before any child renders at all.
  const [trackpadMode, setTrackpadMode] = useState(() => {
    if (typeof window !== "undefined") localStorage.setItem(TRACKPAD_MODE_KEY, "0");
    return false;
  });
  const handlerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    function handleChanged() {
      setTrackpadMode(localStorage.getItem(TRACKPAD_MODE_KEY) === "1");
    }
    window.addEventListener(TRACKPAD_CHANGED_EVENT, handleChanged);
    return () => window.removeEventListener(TRACKPAD_CHANGED_EVENT, handleChanged);
  }, []);

  const toggle = useCallback(() => {
    if (handlerRef.current) {
      handlerRef.current();
      return;
    }
    const next = localStorage.getItem(TRACKPAD_MODE_KEY) !== "1";
    localStorage.setItem(TRACKPAD_MODE_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(TRACKPAD_CHANGED_EVENT));
  }, []);

  // A single, always-present "T" listener for the whole review session —
  // not just while a HanziWritingBox happens to be mounted (it wasn't
  // reachable at all while viewing the revealed static preview, which has
  // no box and thus no keydown handler of its own). `toggle` already
  // delegates to the mounted box's own toggle when one exists (needed for
  // the actual pointer-lock request to happen inside this same keypress),
  // or falls back to flipping the persisted flag directly — either way,
  // this is now the *only* place "T" is handled, so HanziWritingBox no
  // longer has its own "t"/"T" case (that would double-toggle otherwise).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.key === "t" || e.key === "T") toggle();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  const registerToggleHandler = useCallback((fn: (() => void) | null) => {
    handlerRef.current = fn;
  }, []);

  return (
    <TrackpadModeContext.Provider value={{ trackpadMode, toggle, registerToggleHandler }}>
      {children}
    </TrackpadModeContext.Provider>
  );
}

export function useTrackpadModeContext() {
  return useContext(TrackpadModeContext);
}
