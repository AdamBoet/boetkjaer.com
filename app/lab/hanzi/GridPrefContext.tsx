"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Whether to show the tian zi ge guide cross in writing/preview boxes — a
// plain persisted visual preference, global across sessions (unlike
// trackpad mode, this isn't reset per review session on purpose).
const GRID_PREF_KEY = "hanziShowGrid";

type Ctx = {
  showGrid: boolean;
  toggle: () => void;
};

const defaultCtx: Ctx = {
  showGrid: true,
  toggle: () => {},
};

const GridPrefContext = createContext<Ctx>(defaultCtx);

export function GridPrefProvider({ children }: { children: React.ReactNode }) {
  // Starts true (matching the existing default, and the server-rendered
  // markup) then swaps in the saved preference once mounted — avoids a
  // hydration mismatch from reading localStorage during the first render.
  const [showGrid, setShowGrid] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(GRID_PREF_KEY);
    if (saved != null) setShowGrid(saved === "1");
  }, []);

  function toggle() {
    setShowGrid((prev) => {
      const next = !prev;
      localStorage.setItem(GRID_PREF_KEY, next ? "1" : "0");
      return next;
    });
  }

  return <GridPrefContext.Provider value={{ showGrid, toggle }}>{children}</GridPrefContext.Provider>;
}

export function useGridPref() {
  return useContext(GridPrefContext);
}
