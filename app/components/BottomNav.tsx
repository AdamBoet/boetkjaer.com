"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/lab", label: "Overview", icon: "⊞" },
  { href: "/lab/hanzi", label: "汉字 Hanzi", icon: "字" },
  { href: "/lab/economy", label: "Economy", icon: "$" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 md:hidden z-30 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex">
      {nav.map(({ href, label, icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs transition-colors ${
              active ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 dark:text-zinc-500"
            }`}
          >
            <span className="text-xl leading-none">{icon}</span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
