import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { directoryNavigation, footerNavigation, workspaceNavigation, type NavItem } from "../lib/navigation";
import { BreadcrumbBar, PageChrome } from "./page-chrome";

function NavIcon({ name }: { name: string }) {
  const common = "h-4 w-4 shrink-0";
  if (name === "Dashboard") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="9" y="2.5" width="4.5" height="4.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="2.5" y="9" width="4.5" height="4.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="9" y="9" width="4.5" height="4.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (name === "Payments") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2.5 6.5h11" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (name === "Proforma invoices") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3" y="2" width="10" height="12" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "Subscriptions") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2.5 6.5h11M6 2.8v2.2M10 2.8v2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "Clients") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="5.2" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.6 13c.7-2.1 2.3-3.1 4.4-3.1s3.7 1 4.4 3.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "Vendors") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 6.5 8 3.2l5 3.3V13H3V6.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M6.5 13V9.2h3V13" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (name === "Products") {
    return (
      <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 6.2 8 3.4l5 2.8v6.2c0 .4-.3.8-.8.8H3.8c-.5 0-.8-.4-.8-.8V6.2Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M3.2 6.4 8 9.1l4.8-2.7M8 9.1V13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
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
    isActive ? "bg-selected font-medium text-primary" : "text-ink hover:bg-canvas"
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

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-5 first:mt-0">
      <p className="px-2.5 pb-1 text-[12px] font-medium tracking-wide text-muted uppercase">{label}</p>
      <div className="flex flex-col gap-0.5">
        {items.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => navClass(isActive)}>
            <NavIcon name={link.label} />
            {link.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function AccountBlock({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts.slice(0, 2).map((part) => part[0] ?? "").join("") || "U").toUpperCase();
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-selected text-[12px] font-semibold text-primary" aria-hidden="true">
        {letters}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{name}</p>
        <button type="button" className="text-[13px] font-medium text-secondary hover:text-ink" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export function Shell() {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const isAdmin = profile?.is_admin === true;
  const accountName = profile?.full_name || "Account";
  const workspace = workspaceNavigation();
  const directory = directoryNavigation();
  const footer = footerNavigation(isAdmin);

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
      <nav className="flex flex-col" aria-label={label}>
        <NavGroup label="Workspace" items={workspace} />
        <NavGroup label="Directory" items={directory} />
      </nav>
    );
  }

  return (
    <PageChrome>
      <div className="min-h-screen bg-canvas">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[90] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <aside className="fixed inset-y-0 left-0 hidden w-[216px] flex-col border-r border-line bg-white px-3 py-4 lg:flex">
          <Brand />
          <div className="mt-6 flex-1 overflow-y-auto">{navigation("Main")}</div>
          <div className="border-t border-line pt-3">
            {footer.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `${navClass(isActive)} mb-2`}>
                <NavIcon name={link.label} />
                {link.label}
              </NavLink>
            ))}
            <AccountBlock name={accountName} onSignOut={() => void signOut()} />
          </div>
        </aside>
        <div className="lg:pl-[216px]">
          <header className="sticky top-0 z-30 flex h-[52px] items-center gap-3 border-b border-line bg-white px-4 sm:px-6 lg:px-7">
            <button
              ref={menuButtonRef}
              type="button"
              className="h-10 shrink-0 rounded-lg border border-line bg-white px-3 text-sm lg:hidden"
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen((current) => !current)}
            >
              Menu
            </button>
            <BreadcrumbBar />
          </header>
          {open ? (
            <div className="fixed inset-x-0 top-[52px] bottom-0 z-40 lg:hidden">
              <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close menu" onClick={() => setOpen(false)} />
              <div
                ref={drawerRef}
                id="mobile-nav"
                role="dialog"
                aria-modal="true"
                aria-label="Main menu"
                className="absolute inset-y-0 left-0 flex w-[216px] flex-col bg-white px-3 py-4"
              >
                <Brand />
                <div className="mt-6 flex-1 overflow-y-auto">{navigation("Main")}</div>
                <div className="border-t border-line pt-3">
                  {footer.map((link) => (
                    <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `${navClass(isActive)} mb-2`}>
                      <NavIcon name={link.label} />
                      {link.label}
                    </NavLink>
                  ))}
                  <AccountBlock name={accountName} onSignOut={() => void signOut()} />
                </div>
              </div>
            </div>
          ) : null}
          <main id="content" className="px-4 py-5 sm:px-6 sm:py-6 lg:px-7 lg:py-7">
            <Outlet />
          </main>
        </div>
      </div>
    </PageChrome>
  );
}
