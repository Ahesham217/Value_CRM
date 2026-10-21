import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Menu } from "./ui";

const links = [
  { to: "/pis", label: "Proforma invoices" },
  { to: "/subscriptions", label: "Subscriptions" },
  { to: "/clients", label: "Clients" },
  { to: "/vendors", label: "Vendors" },
  { to: "/products", label: "Products" },
];

function NavIcon({ name }: { name: string }) {
  const common = "h-4 w-4 shrink-0";
  if (name === "Proforma invoices") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3" y="2" width="10" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "Clients" || name === "Vendors") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="5.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.5 13.2c.7-2 2.3-3 4.5-3s3.8 1 4.5 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "Subscriptions") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2.5 6.5h11M6 2.8v2.2M10 2.8v2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "Products") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 6.5 8 3.5l5 3v6.2c0 .5-.4.8-.9.8H3.9c-.5 0-.9-.3-.9-.8V6.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 2.2v1.4M8 12.4v1.4M2.2 8h1.4M12.4 8h1.4M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function navClass(isActive: boolean) {
  return `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${
    isActive ? "bg-primary-soft font-medium text-primary" : "text-ink hover:bg-canvas"
  }`;
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1">
      <img src="/favicon.png" alt="" className="h-7 w-7" />
      <p className="text-[15px] font-semibold tracking-tight text-ink">Value CRM</p>
    </div>
  );
}

export function Shell() {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const items = [...links, ...(profile?.is_admin ? [{ to: "/settings", label: "Settings" }] : [])];

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const node = drawerRef.current;
    const focusable = () =>
      [...(node?.querySelectorAll<HTMLElement>("a, button") ?? [])].filter((element) => !element.hasAttribute("disabled"));
    focusable()[0]?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function navigation(label: string): ReactNode {
    return (
      <nav className="flex flex-col gap-0.5" aria-label={label}>
        {items.map((link) => (
          <NavLink key={link.to} to={link.to} className={({ isActive }) => navClass(isActive)}>
            <NavIcon name={link.label} />
            {link.label}
          </NavLink>
        ))}
      </nav>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[90] focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-line bg-white px-3 py-4 md:flex">
        <Brand />
        <div className="mt-6 flex-1">{navigation("Main")}</div>
        <div className="border-t border-line pt-3">
          <Menu
            appearance="account"
            align="start"
            label={profile?.full_name || "Account"}
            items={[{ label: "Sign out", onSelect: () => void signOut() }]}
          />
        </div>
      </aside>
      <div className="md:pl-56">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-line bg-white px-4 md:hidden">
          <button
            ref={menuButtonRef}
            type="button"
            className="h-10 rounded-md border border-line px-3 text-sm"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((current) => !current)}
          >
            Menu
          </button>
          <p className="text-sm font-semibold text-ink">Value CRM</p>
          <Menu
            appearance="account"
            align="end"
            label={profile?.full_name || "Account"}
            items={[{ label: "Sign out", onSelect: () => void signOut() }]}
          />
        </header>
        {open ? (
          <div className="fixed inset-x-0 bottom-0 top-14 z-40 md:hidden">
            <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close menu" onClick={() => setOpen(false)} />
            <div
              ref={drawerRef}
              id="mobile-nav"
              role="dialog"
              aria-modal="true"
              aria-label="Main menu"
              className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white px-3 py-4"
            >
              <Brand />
              <div className="mt-6 flex-1">{navigation("Main")}</div>
            </div>
          </div>
        ) : null}
        <main id="content" className="px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
