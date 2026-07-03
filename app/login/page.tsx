"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/lab-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      router.push("/lab");
      router.refresh();
    } else {
      setError("Invalid credentials");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 p-8 rounded-2xl w-80 flex flex-col gap-4"
      >
        <h1 className="text-gray-900 dark:text-white text-2xl font-light tracking-widest text-center">
          BØTKJÆR LABS
        </h1>

        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          className="bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-white rounded-lg px-4 py-2 outline-none focus:ring-1 focus:ring-zinc-500"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-white rounded-lg px-4 py-2 outline-none focus:ring-1 focus:ring-zinc-500"
        />

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="bg-zinc-900 text-white rounded-lg py-2 font-medium hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 disabled:opacity-50 transition"
        >
          {loading ? "Entering…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
