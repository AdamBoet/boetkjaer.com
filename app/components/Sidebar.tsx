"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const nav = [
  { href: "/lab", label: "Overview", icon: "⊞" },
  { href: "/lab/hanzi", label: "汉字 Hanzi", icon: "字" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-52 shrink-0 border-r border-zinc-200 dark:border-zinc-800 min-h-screen p-4 flex-col gap-1 bg-white dark:bg-zinc-950">
      <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest px-3 mb-3">
        Bøtkjær Labs
      </p>
      {nav.map(({ href, label, icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
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

      <div className="mt-auto flex items-center gap-2">
        <form action="/api/lab-logout" method="POST" className="flex-1">
          <button
            type="submit"
            title="Log out"
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <span className="text-base w-5 text-center">⏻</span>
            Logout
          </button>
        </form>
        <ThemeToggle />
      </div>
    </aside>
  );
}
