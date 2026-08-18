"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

// Must match HanziWritingBox.tsx's own TRACKPAD_MODE_KEY — this is the same
// persisted preference, just also readable/writable from the review header.
const TRACKPAD_MODE_KEY = "hanziTrackpadMode";

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
  reportState: (value: boolean) => void;
  registerToggleHandler: (fn: (() => void) | null) => void;
};

const defaultCtx: Ctx = {
  trackpadMode: false,
  toggle: () => {},
  reportState: () => {},
  registerToggleHandler: () => {},
};

const TrackpadModeContext = createContext<Ctx>(defaultCtx);

export function TrackpadModeProvider({ children }: { children: React.ReactNode }) {
  const [trackpadMode, setTrackpadMode] = useState(false);
  const handlerRef = useRef<(() => void) | null>(null);

  const toggle = useCallback(() => {
    if (handlerRef.current) {
      handlerRef.current();
      return;
    }
    setTrackpadMode((prev) => {
      const next = !prev;
      localStorage.setItem(TRACKPAD_MODE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const reportState = useCallback((value: boolean) => setTrackpadMode(value), []);
  const registerToggleHandler = useCallback((fn: (() => void) | null) => {
    handlerRef.current = fn;
  }, []);

  return (
    <TrackpadModeContext.Provider value={{ trackpadMode, toggle, reportState, registerToggleHandler }}>
      {children}
    </TrackpadModeContext.Provider>
  );
}

export function useTrackpadModeContext() {
  return useContext(TrackpadModeContext);
}
