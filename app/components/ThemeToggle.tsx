"use client";

import { useTheme } from "next-themes";
import { useState, useEffect, useCallback } from "react";
import SunCalc from "suncalc";

const DEFAULT_COORDS = { lat: 55.68, lng: 12.57 }; // Copenhagen fallback
const LOCATION_CACHE_KEY = "themeLocation";

function getAutoTheme(lat: number, lng: number): "light" | "dark" {
  const now = new Date();
  const times = SunCalc.getTimes(now, lat, lng);
  return now >= times.sunrise && now <= times.sunset ? "light" : "dark";
}

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isAuto, setIsAuto] = useState(true);
  const [coords, setCoords] = useState(DEFAULT_COORDS);

  // Apply auto theme
  const applyAuto = useCallback((lat: number, lng: number) => {
    setTheme(getAutoTheme(lat, lng));
  }, [setTheme]);

  useEffect(() => {
    setMounted(true);

    // Only ever ask the browser for location once — cache whatever we get
    // (real coords or the fallback) so every later page load reuses it
    // instead of re-prompting for permission each time.
    const cached = localStorage.getItem(LOCATION_CACHE_KEY);
    if (cached) {
      const c = JSON.parse(cached);
      setCoords(c);
      if (isAuto) applyAuto(c.lat, c.lng);
      return;
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(c));
          setCoords(c);
          if (isAuto) applyAuto(c.lat, c.lng);
        },
        () => {
          localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(DEFAULT_COORDS));
          if (isAuto) applyAuto(DEFAULT_COORDS.lat, DEFAULT_COORDS.lng);
        }
      );
    } else {
      localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(DEFAULT_COORDS));
      applyAuto(DEFAULT_COORDS.lat, DEFAULT_COORDS.lng);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check every minute when in auto mode
  useEffect(() => {
    if (!mounted || !isAuto) return;
    applyAuto(coords.lat, coords.lng);
    const id = setInterval(() => applyAuto(coords.lat, coords.lng), 60_000);
    return () => clearInterval(id);
  }, [mounted, isAuto, coords, applyAuto]);

  const handleToggle = () => {
    setIsAuto(false);
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  if (!mounted) return null;

  const isDark = resolvedTheme === "dark";

  return (
    <button
      onClick={handleToggle}
      title={isDark ? "Switch to day mode" : "Switch to night mode"}
      className="w-9 h-9 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
    >
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}
