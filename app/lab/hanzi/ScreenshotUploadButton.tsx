"use client";

import { useRef, useState } from "react";

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
  const [status, setStatus] = useState<{ done: number; total: number; failed: number } | null>(null);

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setStatus({ done: 0, total: files.length, failed: 0 });
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
      setStatus({ done, total: files.length, failed });
    }
  }

  return (
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
      {status && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {status.done + status.failed < status.total
            ? `Uploading ${status.done + status.failed}/${status.total}…`
            : status.failed > 0
            ? `Uploaded ${status.done}/${status.total} (${status.failed} failed)`
            : `Uploaded ${status.done}`}
        </span>
      )}
    </div>
  );
}
