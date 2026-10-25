"use client";
import { ThemeProvider } from "next-themes";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    // Fresh storage key: the old sunset-based auto mode saved "dark" for many
    // visitors under next-themes' default "theme" key, which would otherwise stick.
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="theme-choice">
      {children}
    </ThemeProvider>
  );
}
