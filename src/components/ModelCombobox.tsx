import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { searchCatalogue, type CatalogueProduct } from "../lib/catalogue";
import { exactProduct } from "../lib/catalogue-rank";
import { errorText } from "../lib/errors";
import { modelKey } from "../lib/model-identity";
import { archiveRow } from "../lib/records";
import { AnchoredList, cellControlClass, controlClass } from "./ui";

type Option =
  | { kind: "product"; product: CatalogueProduct }
  | { kind: "create"; model: string };

export function ModelCombobox({
  value,
  committedModel,
  disabled,
  canCreate,
  autoFocus = false,
  compact = false,
  plain = false,
  label = "Model",
  onChange,
  onSelect,
  onCreate,
  onRevert,
  onAutoFocused,
}: {
  value: string;
  committedModel: string | null;
  disabled: boolean;
  canCreate: boolean;
  autoFocus?: boolean;
  compact?: boolean;
  plain?: boolean;
  label?: string;
  onChange: (value: string) => void;
  onSelect: (product: CatalogueProduct, notice?: string | null) => void;
  onCreate: (model: string) => void;
  onRevert: () => void;
  onAutoFocused?: () => void;
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
  const [results, setResults] = useState<CatalogueProduct[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const onAutoFocusedRef = useRef(onAutoFocused);
  onAutoFocusedRef.current = onAutoFocused;

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
    setOpen(true);
    onAutoFocusedRef.current?.();
  }, [autoFocus]);

  useEffect(() => {
    if (!open || disabled) return;
    const requestId = ++requestRef.current;
    const term = value;
    if (!term.trim()) {
      setResults([]);
      setLoading(false);
      setSearchError(null);
      return () => {
        requestRef.current += 1;
      };
    }
    setLoading(true);
    const handle = window.setTimeout(() => {
      searchCatalogue(term)
        .then((rows) => {
          if (requestRef.current !== requestId) return;
          setResults(rows);
          setSearchError(null);
          setLoading(false);
          setActiveIndex(0);
        })
        .catch((caught) => {
          if (requestRef.current !== requestId) return;
          setSearchError(errorText(caught));
          setLoading(false);
        });
    }, 200);
    return () => {
      window.clearTimeout(handle);
      requestRef.current += 1;
    };
  }, [disabled, open, value]);

  const trimmed = value.trim();
  const exact = exactProduct(trimmed, results);
  const exactArchived = exact?.archived_at ? exact : null;
  const selectable = results.filter((product) => !product.archived_at);
  const showCreate = Boolean(trimmed) && !loading && !searchError && !exact;
  const options: Option[] = [
    ...selectable.map((product) => ({ kind: "product" as const, product })),
    ...(showCreate ? [{ kind: "create" as const, model: trimmed }] : []),
  ];
  const active = options[activeIndex] ?? null;

  function finishBlur() {
    setOpen(false);
    if (committedModel && modelKey(value) !== modelKey(committedModel)) onRevert();
    else if (committedModel && value !== committedModel) onRevert();
  }

  function choose(option: Option) {
    if (option.kind === "create") {
      if (!canCreate) return;
      setOpen(false);
      onCreate(option.model);
      window.setTimeout(() => {
        pickedRef.current = false;
      }, 0);
      return;
    }
    setOpen(false);
    onSelect(option.product);
    window.setTimeout(() => {
      pickedRef.current = false;
    }, 0);
  }

  async function restore(product: CatalogueProduct) {
    if (restoring) return;
    setRestoring(true);
    setSearchError(null);
    try {
      await archiveRow("products", product.id, false);
      setOpen(false);
      onSelect(
        { ...product, archived_at: null },
        `Restored ‘${product.model_code}’ and selected it. Catalogue details were not changed.`,
      );
    } catch (caught) {
      setSearchError(errorText(caught));
    } finally {
      setRestoring(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
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
    <div className="relative">
      {compact ? null : (
        <span id={`${baseId}-label`} className="mb-1 block text-sm font-medium text-secondary">
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        id={`${baseId}-model`}
        className={plain ? `${cellControlClass} font-medium` : controlClass}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={compact ? label : undefined}
        aria-labelledby={compact ? undefined : `${baseId}-label`}
        aria-activedescendant={open && active ? `${baseId}-opt-${activeIndex}` : undefined}
        disabled={disabled}
        value={value}
        placeholder="Search models"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (pickedRef.current) {
            pickedRef.current = false;
            return;
          }
          const next = event.relatedTarget;
          if (next instanceof Node && listRef.current?.contains(next)) return;
          finishBlur();
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open && !disabled ? (
        <AnchoredList
          anchorRef={inputRef}
          panelRef={listRef}
          open
          id={listId}
          label="Models"
          onMouseDown={() => {
            pickedRef.current = true;
          }}
        >
          {exactArchived ? (
            <div className="border-b border-line px-3 py-2 text-sm">
              <p>Model ‘{exactArchived.model_code}’ is archived and cannot be created again.</p>
              {canCreate ? (
                <button
                  type="button"
                  className="mt-2 text-navy-800 underline"
                  disabled={restoring}
                  onMouseDown={(event) => {
                    pickedRef.current = true;
                    event.preventDefault();
                  }}
                  onClick={() => void restore(exactArchived)}
                >
                  {restoring ? "Restoring…" : "Restore product"}
                </button>
              ) : (
                <p className="mt-1 text-muted">Ask a colleague who manages products to restore it.</p>
              )}
            </div>
          ) : null}
          {loading ? <p className="px-3 py-2 text-sm text-muted">Searching…</p> : null}
          {searchError ? <p className="px-3 py-2 text-sm text-danger">{searchError}</p> : null}
          {!loading && !trimmed ? <p className="px-3 py-2 text-sm text-muted">Type a model name to search.</p> : null}
          {!loading && trimmed && options.length === 0 && !exactArchived && !searchError ? (
            <p className="px-3 py-2 text-sm text-muted">No matching products.</p>
          ) : null}
          {options.map((option, index) => {
            const selected = index === activeIndex;
            const label = option.kind === "create"
              ? `Create new product ‘${option.model}’`
              : `${option.product.model_code} · ${option.product.vendor_name || "No vendor"}`;
            return (
              <button
                key={option.kind === "create" ? "create" : option.product.id}
                id={`${baseId}-opt-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={`block w-full px-3 py-2 text-left text-sm ${selected ? "bg-navy-100" : "hover:bg-table"}`}
                onMouseDown={(event) => {
                  pickedRef.current = true;
                  event.preventDefault();
                }}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                {option.kind === "product" ? (
                  <>
                    <span className="font-medium">{option.product.model_code}</span>
                    <span className="text-muted"> · {option.product.vendor_name || "No vendor"}</span>
                    {option.product.description ? <span className="block truncate text-muted">{option.product.description}</span> : null}
                  </>
                ) : canCreate ? (
                  <span className="font-medium text-navy-800">{label}</span>
                ) : (
                  <span className="text-secondary">
                    No saved product matches ‘{option.model}’. Ask a colleague who manages products to add it.
                  </span>
                )}
              </button>
            );
          })}
        </AnchoredList>
      ) : null}
    </div>
  );
}
