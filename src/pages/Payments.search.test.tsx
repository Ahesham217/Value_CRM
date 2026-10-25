/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_SIZE } from "../lib/records";
import { SEARCH_DEBOUNCE_MS } from "../lib/useDebouncedValue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const payments = vi.hoisted(() => ({
  rpc: vi.fn((_name: string, args: {
    p_search: string | null;
    p_currency: string | null;
    p_preset: string | null;
    p_offset: number;
  }) => {
    void args;
    return Promise.resolve({
      data: {
        today: "2026-10-25",
        view: "outstanding",
        count: 40,
        totals: [],
        rows: [],
        leads: [],
      },
      error: null,
    });
  }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: payments.rpc,
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
  },
}));

import { PaymentsPage } from "./Payments";

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/payments?q=next&currency=EUR")}>External search</button>
      <button type="button" onClick={() => navigate(-1)}>History back</button>
    </>
  );
}

function renderPayments(entry: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <PaymentsPage />
        <LocationProbe />
        <HistoryControls />
      </MemoryRouter>,
    );
  });
  return container;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function searchBox(container: ParentNode) {
  const label = [...container.querySelectorAll("label")].find((node) => node.textContent?.includes("Search PI or client"));
  const input = label?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error("Search input missing");
  return input;
}

function typeSearch(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Input value setter missing");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButton(container: ParentNode, label: string) {
  const found = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing ${label}`);
  act(() => {
    found.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function paramsOf(container: ParentNode) {
  const href = container.querySelector("[data-testid=location]")?.textContent ?? "";
  return new URLSearchParams(href.split("?")[1] ?? "");
}

function rpcArgs() {
  return payments.rpc.mock.calls.map((call) => call[1]);
}

describe("Payments search synchronization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    payments.rpc.mockClear();
  });

  afterEach(() => {
    for (const view of mounted.splice(0)) {
      act(() => view.root.unmount());
      view.container.remove();
    }
    vi.useRealTimers();
  });

  it("does not let the previous debounced search restore q after Reset", async () => {
    const container = renderPayments("/payments?q=old&currency=USD");
    await flush();
    expect(searchBox(container).value).toBe("old");
    expect(paramsOf(container).get("q")).toBe("old");
    expect(paramsOf(container).get("currency")).toBe("USD");

    const beforeReset = payments.rpc.mock.calls.length;
    clickButton(container, "Reset filters");
    await flush();
    expect(paramsOf(container).get("q")).toBeNull();
    expect(paramsOf(container).get("currency")).toBeNull();
    expect(paramsOf(container).get("view")).toBe("outstanding");
    expect(searchBox(container).value).toBe("");

    await flush(SEARCH_DEBOUNCE_MS + 50);
    expect(paramsOf(container).get("q")).toBeNull();
    expect(paramsOf(container).get("currency")).toBeNull();
    expect(searchBox(container).value).toBe("");
    const later = rpcArgs().slice(beforeReset);
    expect(later.length).toBeGreaterThan(0);
    expect(later.some((args) => args.p_search === "old")).toBe(false);
    expect(later.at(-1)).toMatchObject({ p_search: null, p_currency: null, p_offset: 0 });
  });

  it("drops a search typed just before Reset instead of writing it back", async () => {
    const container = renderPayments("/payments?q=old&currency=USD");
    await flush();
    typeSearch(searchBox(container), "draft");
    await flush(100);
    expect(paramsOf(container).get("q")).toBe("old");

    const beforeReset = payments.rpc.mock.calls.length;
    clickButton(container, "Reset filters");
    await flush();
    await flush(SEARCH_DEBOUNCE_MS + 50);
    expect(paramsOf(container).get("q")).toBeNull();
    expect(paramsOf(container).get("currency")).toBeNull();
    expect(searchBox(container).value).toBe("");
    expect(rpcArgs().slice(beforeReset).some((args) => args.p_search === "draft" || args.p_search === "old")).toBe(false);
  });

  it("follows browser history and an external payments link instead of a pending search", async () => {
    const container = renderPayments("/payments?q=old&currency=USD&page=2");
    await flush();
    expect(rpcArgs().at(-1)).toMatchObject({ p_search: "old", p_currency: "USD", p_offset: PAGE_SIZE });
    typeSearch(searchBox(container), "draft");
    await flush(100);
    expect(paramsOf(container).get("q")).toBe("old");
    expect(paramsOf(container).get("page")).toBe("2");

    clickButton(container, "External search");
    await flush();
    await flush(SEARCH_DEBOUNCE_MS + 50);
    expect(paramsOf(container).get("q")).toBe("next");
    expect(paramsOf(container).get("currency")).toBe("EUR");
    expect(paramsOf(container).get("page")).toBeNull();
    expect(searchBox(container).value).toBe("next");
    expect(rpcArgs().at(-1)).toMatchObject({ p_search: "next", p_currency: "EUR", p_offset: 0 });
    expect(rpcArgs().some((args) => args.p_search === "draft")).toBe(false);

    clickButton(container, "History back");
    await flush();
    await flush(SEARCH_DEBOUNCE_MS + 50);
    expect(paramsOf(container).get("q")).toBe("old");
    expect(paramsOf(container).get("currency")).toBe("USD");
    expect(paramsOf(container).get("page")).toBe("2");
    expect(searchBox(container).value).toBe("old");
    expect(rpcArgs().at(-1)).toMatchObject({ p_search: "old", p_currency: "USD", p_offset: PAGE_SIZE });
    expect(rpcArgs().some((args) => args.p_search === "draft")).toBe(false);
  });

  it("waits 300 ms after the last keystroke and keeps the other filters", async () => {
    const container = renderPayments("/payments?q=old&currency=USD&preset=EG&page=2");
    await flush();
    const initialCalls = payments.rpc.mock.calls.length;
    expect(rpcArgs().at(-1)).toMatchObject({
      p_search: "old",
      p_currency: "USD",
      p_preset: "EG",
      p_offset: PAGE_SIZE,
    });

    typeSearch(searchBox(container), "a");
    await flush(SEARCH_DEBOUNCE_MS - 1);
    expect(paramsOf(container).get("q")).toBe("old");
    expect(paramsOf(container).get("currency")).toBe("USD");
    expect(paramsOf(container).get("preset")).toBe("EG");
    expect(paramsOf(container).get("page")).toBe("2");
    expect(searchBox(container).value).toBe("a");
    expect(payments.rpc.mock.calls.length).toBe(initialCalls);

    typeSearch(searchBox(container), "ab");
    await flush(SEARCH_DEBOUNCE_MS - 1);
    expect(paramsOf(container).get("q")).toBe("old");
    expect(paramsOf(container).get("page")).toBe("2");
    expect(payments.rpc.mock.calls.length).toBe(initialCalls);

    await flush(1);
    expect(paramsOf(container).get("q")).toBe("ab");
    expect(paramsOf(container).get("currency")).toBe("USD");
    expect(paramsOf(container).get("preset")).toBe("EG");
    expect(paramsOf(container).get("page")).toBeNull();
    expect(paramsOf(container).get("view")).toBe("outstanding");
    expect(searchBox(container).value).toBe("ab");
    expect(rpcArgs().at(-1)).toMatchObject({
      p_search: "ab",
      p_currency: "USD",
      p_preset: "EG",
      p_offset: 0,
    });

    typeSearch(searchBox(container), "abc");
    await flush(SEARCH_DEBOUNCE_MS - 1);
    expect(paramsOf(container).get("q")).toBe("ab");
    expect(searchBox(container).value).toBe("abc");
    await flush(1);
    expect(paramsOf(container).get("q")).toBe("abc");
    expect(paramsOf(container).get("currency")).toBe("USD");
    expect(paramsOf(container).get("preset")).toBe("EG");
    expect(searchBox(container).value).toBe("abc");
    expect(rpcArgs().at(-1)).toMatchObject({ p_search: "abc", p_currency: "USD", p_preset: "EG", p_offset: 0 });
  });
});
