/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "./useDebouncedValue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function SearchProbe({ onDebounced }: { onDebounced: (value: string) => void }) {
  const [text, setText] = useState("");
  const debounced = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);
  onDebounced(debounced);
  return <input aria-label="Search" value={text} onChange={(event) => setText(event.target.value)} />;
}

describe("search debounce", () => {
  const mounted: { root: Root; container: HTMLDivElement }[] = [];

  afterEach(() => {
    for (const view of mounted.splice(0)) {
      act(() => view.root.unmount());
      view.container.remove();
    }
    vi.useRealTimers();
  });

  it("waits until typing pauses before publishing the search text", () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() => {
      root.render(<SearchProbe onDebounced={(value) => seen.push(value)} />);
    });
    const input = container.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("Search input missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter missing");

    act(() => {
      setter.call(input, "Al");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(seen.at(-1)).toBe("");

    act(() => {
      setter.call(input, "Alex");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(seen.at(-1)).toBe("Alex");
  });
});
