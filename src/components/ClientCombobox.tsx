import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { errorText } from "../lib/errors";
import { supabase } from "../lib/supabase";
import type { Client } from "../lib/types";
import { AnchoredList, Button, controlClass } from "./ui";

export function ClientCombobox({
  query,
  selected,
  disabled,
  onQueryChange,
  onSelect,
  onClear,
  onRevert,
}: {
  query: string;
  selected: Client | null;
  disabled: boolean;
  onQueryChange: (value: string) => void;
  onSelect: (client: Client) => void;
  onClear: () => void;
  onRevert: () => void;
}) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const pickedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<Client[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open || disabled) return;
    const requestId = ++requestRef.current;
    const term = query.trim().replace(/[%_]/g, "");
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      setSearchError(null);
      return () => {
        requestRef.current += 1;
      };
    }
    setLoading(true);
    const handle = window.setTimeout(() => {
      void supabase
        .from("clients")
        .select("*")
        .is("archived_at", null)
        .ilike("company_name", `%${term}%`)
        .limit(20)
        .then(({ data, error }) => {
          if (requestRef.current !== requestId) return;
          if (error) {
            setSearchError(errorText(error));
            setLoading(false);
            return;
          }
          setResults((data ?? []) as Client[]);
          setSearchError(null);
          setLoading(false);
          setActiveIndex(0);
        });
    }, 200);
    return () => {
      window.clearTimeout(handle);
      requestRef.current += 1;
    };
  }, [disabled, open, query]);

  const active = results[activeIndex] ?? null;

  function choose(client: Client) {
    setOpen(false);
    onSelect(client);
    window.setTimeout(() => {
      pickedRef.current = false;
    }, 0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      onRevert();
      return;
    }
    if (event.key === "Enter" && open && active) {
      event.preventDefault();
      choose(active);
    }
  }

  return (
    <div>
      <span id={`${baseId}-label`} className="mb-1 block text-sm font-medium text-secondary">
        Client
      </span>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          className={controlClass}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={`${baseId}-label`}
          aria-activedescendant={open && active ? `${baseId}-opt-${activeIndex}` : undefined}
          disabled={disabled}
          value={query}
          placeholder="Type at least 2 letters"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            if (pickedRef.current) {
              pickedRef.current = false;
              return;
            }
            const next = event.relatedTarget;
            if (next instanceof Node && listRef.current?.contains(next)) return;
            setOpen(false);
            onRevert();
          }}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        {selected && !disabled ? (
          <Button type="button" variant="secondary" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>
      <AnchoredList
        anchorRef={inputRef}
        panelRef={listRef}
        open={open && !disabled}
        id={listId}
        labelledBy={`${baseId}-label`}
        onMouseDown={() => {
          pickedRef.current = true;
        }}
      >
        {loading ? <p className="px-3 py-2 text-sm text-muted">Searching…</p> : null}
        {searchError ? <p className="px-3 py-2 text-sm text-danger">{searchError}</p> : null}
        {!loading && query.trim().length < 2 ? <p className="px-3 py-2 text-sm text-muted">Type at least 2 letters.</p> : null}
        {!loading && query.trim().length >= 2 && results.length === 0 && !searchError ? (
          <p className="px-3 py-2 text-sm text-muted">No matching clients.</p>
        ) : null}
        {results.map((client, index) => (
          <button
            key={client.id}
            id={`${baseId}-opt-${index}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={`block w-full px-3 py-2 text-left text-sm ${index === activeIndex ? "bg-navy-100" : "hover:bg-table"}`}
            onMouseDown={(event) => {
              pickedRef.current = true;
              event.preventDefault();
            }}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => choose(client)}
          >
            <span className="font-medium">{client.company_name}</span>
            {client.country ? <span className="text-muted"> · {client.country}</span> : null}
          </button>
        ))}
      </AnchoredList>
    </div>
  );
}
