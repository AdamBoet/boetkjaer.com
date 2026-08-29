"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface PendingScreenshot {
  id: number;
  image_url: string;
  created_at: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // readAsDataURL gives "data:<mime>;base64,<data>" — strip the prefix.
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Compact icon-button version of a screenshot uploader — dumps dictionary-
// lookup screenshots into screenshot_queue for the nightly job to turn into
// random_words cards (see daily_refresh.py's process_screenshot_queue).
// No page of its own; lives directly on random_words' deck-overview screen.
export default function ScreenshotUploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [pending, setPending] = useState<PendingScreenshot[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  async function refreshPending() {
    try {
      const res = await fetch("/api/upload-screenshot");
      const data = await res.json();
      setPending(data.screenshots ?? []);
    } catch {
      // Silent — the count just won't update this time.
    }
  }

  useEffect(() => {
    refreshPending();
  }, []);

  function goTo(delta: number) {
    setConfirmDeleteId(null);
    setViewIndex((i) => Math.max(0, Math.min(pending.length - 1, i + delta)));
  }

  async function handleDelete(id: number) {
    setConfirmDeleteId(null);
    setPending((prev) => {
      const next = prev.filter((s) => s.id !== id);
      setViewIndex((i) => Math.max(0, Math.min(next.length - 1, i)));
      if (next.length === 0) setShowPopup(false);
      return next;
    });
    try {
      await fetch("/api/upload-screenshot", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // Best effort — a stale row just means it'll show up again on refresh.
    }
  }

  useEffect(() => {
    if (!showPopup) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (confirmDeleteId !== null) setConfirmDeleteId(null);
        else setShowPopup(false);
      } else if (e.key === "ArrowRight") goTo(1);
      else if (e.key === "ArrowLeft") goTo(-1);
      else if (e.key === "Backspace" || e.key === "Delete") {
        const s = pending[viewIndex];
        if (s) setConfirmDeleteId(s.id);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPopup, pending, viewIndex, confirmDeleteId]);

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setUploading({ done: 0, total: files.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const contentBase64 = await fileToBase64(file);
        const res = await fetch("/api/upload-screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, contentType: file.type, contentBase64 }),
        });
        if (!res.ok) throw new Error();
        done += 1;
      } catch {
        failed += 1;
      }
      setUploading({ done, total: files.length, failed });
    }
    await refreshPending();
    // Clear the transient "uploading/failed" line a moment after finishing
    // so the persistent "X uploaded" count (below) is the lasting state.
    setTimeout(() => setUploading(null), 2000);
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          aria-label="Upload screenshots"
          title="Upload dictionary-lookup screenshots"
          className="rounded-lg p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 3.129a.75.75 0 001.09-1.03l-4.25-4.5a.75.75 0 00-1.09 0l-4.25 4.5a.75.75 0 101.09 1.03L9.25 4.636v8.614z" />
            <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
          </svg>
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple onChange={handleSelect} className="hidden" />
        {uploading && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {uploading.done + uploading.failed < uploading.total
              ? `Uploading ${uploading.done + uploading.failed}/${uploading.total}…`
              : uploading.failed > 0
              ? `Uploaded ${uploading.done}/${uploading.total} (${uploading.failed} failed)`
              : `Uploaded ${uploading.done}`}
          </span>
        )}
      </div>

      {!uploading && pending.length > 0 && (
        <button
          onClick={() => {
            setViewIndex(0);
            setShowPopup(true);
          }}
          className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 underline decoration-dotted transition-colors"
        >
          {pending.length} uploaded
        </button>
      )}

      {showPopup &&
        pending.length > 0 &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowPopup(false)}>
            <div
              className="w-full max-w-xs rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                  {viewIndex + 1} / {pending.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmDeleteId(pending[viewIndex].id)}
                    aria-label="Remove screenshot"
                    title="Remove this screenshot"
                    className="text-zinc-400 hover:text-red-500 p-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path
                        fillRule="evenodd"
                        d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <button onClick={() => setShowPopup(false)} aria-label="Close" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                  </button>
                </div>
              </div>

              <div
                  className="relative flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 aspect-square"
                  onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
                  onTouchEnd={(e) => {
                    if (touchStartX.current == null) return;
                    const delta = e.changedTouches[0].clientX - touchStartX.current;
                    if (delta < -50) goTo(1);
                    else if (delta > 50) goTo(-1);
                    touchStartX.current = null;
                  }}
                >
                  {viewIndex > 0 && (
                    <button
                      onClick={() => goTo(-1)}
                      aria-label="Previous"
                      className="absolute left-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white p-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6">
                        <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pending[viewIndex].image_url}
                    alt=""
                    className="max-w-full max-h-full object-contain select-none"
                    draggable={false}
                  />
                  {viewIndex < pending.length - 1 && (
                    <button
                      onClick={() => goTo(1)}
                      aria-label="Next"
                      className="absolute right-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white p-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6">
                        <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {confirmDeleteId !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60">
            <div className="w-full max-w-xs rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl p-5 flex flex-col items-center gap-4">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Delete screenshot?</p>
              <div className="flex items-center gap-3 w-full">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                >
                  No
                </button>
                <button
                  onClick={() => handleDelete(confirmDeleteId)}
                  className="flex-1 rounded-lg px-3 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600"
                >
                  Yes
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
