import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref, type RefObject, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { displayStatusLabel } from "../lib/format";
import { useAnchoredStyle } from "./useAnchoredStyle";

const variants = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-line bg-white text-ink hover:bg-canvas",
  accent: "border border-line bg-white text-ink hover:bg-canvas",
  danger: "border border-line bg-white text-danger hover:bg-danger-soft",
  ghost: "text-secondary hover:bg-canvas hover:text-ink",
  quiet: "text-primary hover:bg-selected",
} as const;

export function buttonClass(variant: keyof typeof variants = "secondary", className = "") {
  return `inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`;
}

export function Button({
  variant = "secondary",
  className = "",
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; ref?: Ref<HTMLButtonElement> }) {
  return <button ref={ref} className={buttonClass(variant, className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1.5 block text-[13px] font-medium text-secondary">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[13px] text-danger">{error}</span> : null}
      {hint && !error ? <span className="mt-1 block text-[13px] text-muted">{hint}</span> : null}
    </label>
  );
}

export const controlClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus-visible:border-primary disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted";

export const cellControlClass =
  "h-9 w-full rounded-lg border border-transparent bg-transparent px-1.5 text-sm text-ink tabular-nums hover:border-line focus:border-primary focus:bg-white disabled:cursor-default disabled:text-ink";

export const thClass = "px-3 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-muted";
export const tdClass = "px-3 py-3 align-middle text-sm text-ink";
export const tableWrapClass = "max-w-full overflow-x-auto rounded-lg border border-line bg-white";
export const theadClass = "bg-table";
export const bodyRowClass = "border-t border-line";
export const clickableRowClass = "cursor-pointer border-t border-line hover:bg-canvas";
export const linkClass = "font-medium text-primary underline decoration-line underline-offset-2 hover:text-primary-hover";
export const quietActionClass = "text-sm font-medium text-primary hover:text-primary-hover";
export const formSheetClass = "w-full max-w-[1120px]";

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} className={`${controlClass} h-auto min-h-16 py-2 ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${controlClass} ${className}`} {...props} />;
}

export function SearchField({
  label = "Search",
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className={`relative block min-w-0 flex-1 basis-56 ${className}`}>
      <span className="sr-only">{label}</span>
      <svg className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10.2 10.2 13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input className={`${controlClass} pl-9`} {...props} />
    </label>
  );
}

export function FiltersButton({
  count = 0,
  expanded,
  controls,
  onClick,
}: {
  count?: number;
  expanded: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="secondary" aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
      Filters
      {count > 0 ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[12px] font-semibold text-white">
          {count}
        </span>
      ) : null}
    </Button>
  );
}

export function FilterPanel({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  return (
    <div id={id} className={`grid gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {children}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function Segmented({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-lg border border-line bg-white">
      {children}
    </div>
  );
}

export function segmentItemClass(selected: boolean): string {
  return `inline-flex h-10 items-center px-3 text-sm first:rounded-l-[7px] last:rounded-r-[7px] ${
    selected ? "bg-primary font-medium text-white" : "text-secondary hover:bg-canvas"
  }`;
}

export function CurrencyStrip({ children, columns }: { children: ReactNode; columns: number }) {
  const layout = columns >= 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "";
  return (
    <div className={`grid divide-y divide-line overflow-hidden rounded-lg border border-line bg-white sm:divide-x sm:divide-y-0 ${layout}`}>
      {children}
    </div>
  );
}

export function CurrencyBlock({
  code,
  lines,
}: {
  code: string;
  lines: { label: string; value: string; tone?: "danger" | "strong" }[];
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-[13px] font-semibold text-ink">{code}</p>
      <dl className="mt-2 space-y-1.5">
        {lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[13px] text-muted">{line.label}</dt>
            <dd className={`text-right text-sm tabular-nums ${line.tone === "danger" ? "font-semibold text-danger" : line.tone === "strong" ? "font-semibold text-ink" : "text-ink"}`}>
              {line.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: "error" | "success" | "info" | "warning";
  children: ReactNode;
}) {
  const styles = {
    error: "border-line bg-danger-soft text-danger",
    success: "border-line bg-success-soft text-success",
    info: "border-line bg-selected text-ink",
    warning: "border-line bg-warning-soft text-warning",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "warning" | "error" | "success";
  children: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    info: "bg-selected text-ink",
    warning: "bg-warning-soft text-ink",
    error: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
  }[tone];
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm ${styles}`}>
      <div className="min-w-0">{children}</div>
      {action}
    </div>
  );
}

export function LoadingNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted" aria-live="polite">{children}</p>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-[34px] font-semibold text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-secondary">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({
  id,
  title,
  meta,
  actions,
}: {
  id?: string;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={id} className="text-[18px] leading-6 font-semibold text-ink">{title}</h2>
        {meta ? <div className="text-sm text-secondary">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function DocumentSurface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-white px-5 py-6 sm:px-7 sm:py-7 ${className}`}>{children}</div>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white px-6 py-8 text-center">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-secondary">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

function pageButtons(page: number, pageCount: number): number[] {
  if (pageCount <= 1) return [];
  const start = Math.max(1, Math.min(page - 1, pageCount - 2));
  const end = Math.min(pageCount, start + 2);
  const first = Math.max(1, end - 2);
  const buttons: number[] = [];
  for (let item = first; item <= end; item += 1) buttons.push(item);
  return buttons;
}

export function Pagination({
  page,
  pageCount,
  onPage,
  total,
  pageSize = 20,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  total?: number;
  pageSize?: number;
}) {
  if (total === 0) return null;
  if (pageCount <= 1 && total == null) return null;
  const from = total == null || total === 0 ? null : (page - 1) * pageSize + 1;
  const to = total == null ? null : Math.min(page * pageSize, total);
  const pages = pageButtons(page, pageCount);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-secondary">
      <p className="tabular-nums">
        {from != null && to != null && total != null ? `${from}–${to} of ${total}` : `Page ${page} of ${pageCount}`}
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <Button type="button" variant="secondary" className="h-9 px-2.5" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            ‹
          </Button>
          {pages.map((item) => (
            <button
              key={item}
              type="button"
              aria-label={`Page ${item}`}
              aria-current={item === page ? "page" : undefined}
              className={`h-9 min-w-9 rounded-lg px-2 text-sm tabular-nums ${item === page ? "bg-primary font-medium text-white" : "text-secondary hover:bg-canvas"}`}
              onClick={() => onPage(item)}
            >
              {item}
            </button>
          ))}
          <Button type="button" variant="secondary" className="h-9 px-2.5" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
            ›
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-table text-secondary",
    issued: "bg-selected text-primary",
    sent: "bg-white text-primary ring-1 ring-line ring-inset",
    accepted: "bg-success-soft text-success",
    cancelled: "bg-danger-soft text-danger",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-medium ${styles[status] ?? styles.draft}`}>
      {displayStatusLabel(status)}
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    const node = dialogRef.current;
    if (!node || node.contains(document.activeElement)) return;
    const focusable = node.querySelector<HTMLElement>("input, select, textarea, button");
    (focusable ?? node).focus();
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="overlay-shadow max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border border-line bg-white p-6"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-[18px] font-semibold text-ink">{title}</h2>
          <button type="button" className={quietActionClass} onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-line bg-white p-6 ${className}`}>{children}</section>;
}

export function Panel({
  title,
  children,
  className = "",
  actions,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={`rounded-lg border border-line bg-white ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-6 py-4">
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        {actions}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

export function Disclosure({
  title,
  summary,
  open,
  onToggle,
  children,
  quiet = false,
}: {
  title: string;
  summary?: string | null;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  quiet?: boolean;
}) {
  const panelId = useId();
  return (
    <div className={quiet ? (open ? "w-full" : "") : "border-t border-line pt-4"}>
      <button
        type="button"
        className={quiet
          ? "inline-flex items-center gap-1.5 text-sm font-medium text-primary"
          : "flex w-full items-start gap-3 text-left"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {quiet ? <span aria-hidden="true">{open ? "–" : "+"}</span> : null}
        <span className="min-w-0">
          <span className={quiet ? "" : "block text-sm font-medium text-ink"}>{title}</span>
          {!open && summary ? <span className={`${quiet ? "ml-2" : "mt-0.5 block"} text-[13px] font-normal text-muted`}>{summary}</span> : null}
        </span>
        {quiet ? null : <span className="ml-auto shrink-0 text-sm text-muted">{open ? "Hide" : "Show"}</span>}
      </button>
      {open ? (
        <div id={panelId} className="pt-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");
  return (letters.join("") || "U").toUpperCase();
}

export type MenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: "danger";
};

export function Menu({
  label,
  items,
  align = "end",
  appearance = "default",
}: {
  label: string;
  items: MenuItem[];
  align?: "start" | "end";
  appearance?: "default" | "quiet" | "account";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const style = useAnchoredStyle(buttonRef, open, { align, matchWidth: false, minWidth: 192 });

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function enabledIndexes() {
    return items.flatMap((item, index) => (item.disabled ? [] : [index]));
  }

  function move(direction: 1 | -1) {
    const indexes = enabledIndexes();
    if (indexes.length === 0) return;
    const position = indexes.indexOf(active);
    const next = indexes[(position + direction + indexes.length) % indexes.length] ?? indexes[0];
    setActive(next);
  }

  function choose(index: number) {
    const item = items[index];
    if (!item || item.disabled) return;
    setOpen(false);
    item.onSelect();
    buttonRef.current?.focus();
  }

  function onPanelKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      const first = enabledIndexes()[0];
      if (first !== undefined) setActive(first);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const indexes = enabledIndexes();
      const last = indexes[indexes.length - 1];
      if (last !== undefined) setActive(last);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
      return;
    }
    if (event.key === "Tab") setOpen(false);
  }

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={
          appearance === "quiet"
            ? "inline-flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none text-muted hover:bg-canvas"
            : appearance === "account"
              ? "inline-flex max-w-48 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-canvas"
              : buttonClass("secondary", "max-w-44 overflow-hidden px-2.5")
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={appearance === "quiet" ? label : undefined}
        onClick={() => {
          setActive(enabledIndexes()[0] ?? 0);
          setOpen((current) => !current);
        }}
      >
        {appearance === "quiet" ? (
          <span aria-hidden="true">···</span>
        ) : appearance === "account" ? (
          <>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-selected text-xs font-semibold text-primary">
              {initials(label)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
            <span aria-hidden="true" className="text-muted">›</span>
          </>
        ) : (
          <span className="min-w-0 truncate">{label}</span>
        )}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={menuId}
              role="menu"
              tabIndex={-1}
              aria-label={label}
              style={style}
              aria-activedescendant={`${menuId}-item-${active}`}
              className="overlay-shadow overflow-auto rounded-lg border border-line bg-white py-1"
              onKeyDown={onPanelKey}
            >
              {items.map((item, index) => (
                <button
                  key={item.label}
                  id={`${menuId}-item-${index}`}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={`block w-full px-3 py-2 text-left text-sm disabled:opacity-50 ${
                    index === active ? "bg-selected" : ""
                  } ${item.tone === "danger" ? "text-danger" : "text-ink"}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="mb-6 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm ${
              selected ? "border-primary font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const direction = event.key === "ArrowRight" ? 1 : -1;
              const next = tabs[(index + direction + tabs.length) % tabs.length];
              if (next) onChange(next.id);
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-selected px-2.5 text-[13px] text-primary hover:bg-canvas"
      aria-label={`Remove ${label}`}
      onClick={onRemove}
    >
      <span>{label}</span>
      <span aria-hidden="true">×</span>
    </button>
  );
}

export function AnchoredList({
  anchorRef,
  panelRef,
  open,
  children,
  id,
  labelledBy,
  label,
  onMouseDown,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLDivElement | null>;
  open: boolean;
  children: ReactNode;
  id?: string;
  labelledBy?: string;
  label?: string;
  onMouseDown?: () => void;
}) {
  const style: CSSProperties = useAnchoredStyle(anchorRef, open, { align: "start", matchWidth: true, minWidth: 240 });
  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="listbox"
      aria-label={label}
      aria-labelledby={labelledBy}
      style={style}
      className="overlay-shadow overflow-auto rounded-lg border border-line bg-white"
      onMouseDown={(event) => {
        event.preventDefault();
        onMouseDown?.();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
