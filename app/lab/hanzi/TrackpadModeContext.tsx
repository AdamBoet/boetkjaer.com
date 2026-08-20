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
  const [trackpadMode, setTrackpadMode] = useState(false);
  const handlerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setTrackpadMode(localStorage.getItem(TRACKPAD_MODE_KEY) === "1");
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
