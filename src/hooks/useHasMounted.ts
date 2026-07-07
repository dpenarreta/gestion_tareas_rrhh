"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

function getSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

// Returns false during SSR and the initial client render, then true right
// after hydration. Replaces the classic `useEffect(() => setMounted(true), [])`
// hydration-guard idiom, which react-hooks/set-state-in-effect flags as a
// synchronous setState call inside an effect.
export function useHasMounted() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
