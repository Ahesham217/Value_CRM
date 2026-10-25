import { useEffect, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 300;

/** Return the latest value only after it has stayed unchanged for the delay. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
