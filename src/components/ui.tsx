import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref, type RefObject, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { displayStatusLabel } from "../lib/format";
import { useAnchoredStyle } from "./useAnchoredStyle";

const variants = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-line bg-white text-ink hover:bg-canvas",
  accent: "border border-primary bg-white text-primary hover:bg-primary-soft",
  danger: "border border-red-200 bg-white text-red-800 hover:bg-red-50",
  ghost: "text-ink hover:bg-canvas",
  quiet: "text-primary hover:bg-primary-soft",
} as const;

export function buttonClass(variant: keyof typeof variants = "secondary", className = "") {
  return `inline-flex h-10 items-center justify-center gap-1 rounded-md px-3.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`;
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
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-800">{error}</span> : null}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export const controlClass =
  "h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted";

export const cellControlClass =
  "h-9 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm text-ink tabular-nums hover:border-line focus:border-primary focus:bg-white disabled:cursor-default disabled:text-ink";

export const thClass = "px-3 py-2.5 text-left text-[13px] font-medium text-muted";
export const tdClass = "px-3 py-3 align-middle text-sm text-ink";

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} className={`${controlClass} h-auto min-h-16 py-1.5 ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${controlClass} ${className}`} {...props} />;
}

export function Banner({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
}) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    info: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-8 tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-dashed border-line bg-white px-6 py-10 text-center">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-slate-600">
        Page {page} of {pageCount}
      </span>
      <Button type="button" variant="secondary" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700",
    issued: "bg-navy-100 text-navy-900",
    sent: "bg-sky-50 text-sky-950",
    accepted: "bg-emerald-50 text-emerald-950",
    cancelled: "bg-red-50 text-red-900",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.draft}`}>
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
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-[10px] border border-line bg-white p-6"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button type="button" className="text-sm text-slate-600 underline" onClick={onClose}>
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
  return <section className={`rounded-[10px] border border-line bg-white p-6 ${className}`}>{children}</section>;
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
    <section className={`rounded-[10px] border border-line bg-white ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-6 py-4">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
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
            ? "inline-flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-muted hover:bg-canvas"
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
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
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
              className="overflow-auto rounded-lg border border-line bg-white py-1 shadow-sm"
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
                    index === active ? "bg-navy-100" : ""
                  } ${item.tone === "danger" ? "text-red-800" : "text-slate-800"}`}
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
      className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-white px-2.5 text-[13px] text-ink hover:bg-canvas"
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
      className="overflow-auto rounded-lg border border-line bg-white shadow-sm"
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
