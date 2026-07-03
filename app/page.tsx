import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <h1 className="text-3xl font-semibold tracking-tight">Adam Bøtkjær</h1>
      <Link
        href="/login"
        className="fixed bottom-6 right-6 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors shadow-sm"
      >
        Go to labs
      </Link>
    </div>
  );
}
