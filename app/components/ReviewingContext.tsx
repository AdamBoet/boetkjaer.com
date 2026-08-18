"use client";

import { createContext, useContext, useState } from "react";

// Lets a page deep in the tree (e.g. the hanzi flashcard review UI) tell the
// Sidebar, its layout sibling, to slide out of the way — there's no direct
// parent/child relationship between them, so this is the shared channel.
const ReviewingContext = createContext<{
  reviewing: boolean;
  setReviewing: (value: boolean) => void;
}>({
  reviewing: false,
  setReviewing: () => {},
});

export function ReviewingProvider({ children }: { children: React.ReactNode }) {
  const [reviewing, setReviewing] = useState(false);
  return <ReviewingContext.Provider value={{ reviewing, setReviewing }}>{children}</ReviewingContext.Provider>;
}

export function useReviewing() {
  return useContext(ReviewingContext);
}
