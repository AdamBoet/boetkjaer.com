"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const nav = [
  { href: "/lab", label: "Overview", icon: "⊞" },
  { href: "/lab/hanzi", label: "Mandarin", icon: "字" },
  { href: "/lab/economy", label: "Economy", icon: "$" },
];

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {open ? (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      ) : (
        <>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </>
      )}
    </svg>
  );
}

export default function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div className="md:hidden">
      <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3">
        <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
          Bøtkjær Labs
        </p>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="p-1.5 -mr-1.5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <MenuIcon open={open} />
        </button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-30 bg-black/30" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            className="fixed top-[49px] left-0 right-0 z-40 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg p-2"
          >
            {nav.map(({ href, label, icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-base w-5 text-center">{icon}</span>
                  {label}
                </Link>
              );
            })}

            <div className="mt-1 pt-1 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
              <form action="/api/lab-logout" method="POST" className="flex-1">
                <button
                  type="submit"
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <span className="text-base w-5 text-center">⏻</span>
                  Logout
                </button>
              </form>
              <ThemeToggle />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
