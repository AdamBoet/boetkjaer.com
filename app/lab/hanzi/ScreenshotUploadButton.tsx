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
          onClick={() => setShowPopup(true)}
          className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 underline decoration-dotted transition-colors"
        >
          {pending.length} uploaded
        </button>
      )}

      {showPopup &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40" onClick={() => setShowPopup(false)}>
            <div
              className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {pending.length} screenshot{pending.length === 1 ? "" : "s"} waiting to be processed tonight
                </h3>
                <button
                  onClick={() => setShowPopup(false)}
                  aria-label="Close"
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {pending.map((s) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={s.id}
                    src={s.image_url}
                    alt=""
                    className="w-full aspect-square object-cover rounded-lg border border-zinc-200 dark:border-zinc-700"
                  />
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
