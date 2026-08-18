"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { useReviewing } from "./ReviewingContext";

const nav = [
  { href: "/lab", label: "Overview", icon: "⊞" },
  { href: "/lab/hanzi", label: "Mandarin", icon: "字" },
  { href: "/lab/economy", label: "Economy", icon: "$" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { reviewing } = useReviewing();

  return (
    <div
      className={`hidden md:block shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
        reviewing ? "w-0" : "w-52"
      }`}
    >
      <aside
        className={`flex w-52 h-full min-h-screen border-r border-zinc-200 dark:border-zinc-800 p-4 flex-col gap-1 bg-white dark:bg-zinc-950 transition-transform duration-300 ease-in-out ${
          reviewing ? "-translate-x-full" : "translate-x-0"
        }`}
      >
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
    </div>
  );
}
