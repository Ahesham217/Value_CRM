import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Menu } from "./ui";

const links = [
  { to: "/pis", label: "PIs" },
  { to: "/clients", label: "Clients" },
  { to: "/vendors", label: "Vendors" },
  { to: "/products", label: "Products" },
];

function navClass(isActive: boolean) {
  return `rounded-md px-2.5 py-2 text-sm ${isActive ? "bg-navy-900 font-semibold text-white" : "text-slate-700 hover:bg-slate-100"}`;
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

  function accountMenu(align: "start" | "end") {
    return (
      <Menu
        label={profile?.full_name || "Account"}
        align={align}
        items={[{ label: "Sign out", onSelect: () => void signOut() }]}
      />
    );
  }

  return (
    <div className="min-h-screen">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[90] focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-52 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-3 py-3">
          <p className="text-xs text-slate-500">Value Technologies</p>
          <p className="text-sm font-semibold text-navy-950">Value CRM</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Main">
          {items.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => navClass(isActive)}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-2">
          <p className="mb-1 truncate px-1 text-xs text-slate-500">{profile?.is_admin ? "Administrator" : "Member"}</p>
          {accountMenu("start")}
        </div>
      </aside>
      <div className="md:pl-52">
        <header className="sticky top-0 z-40 flex h-12 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 md:hidden">
          <button
            ref={menuButtonRef}
            type="button"
            className="h-9 rounded-md border border-slate-300 px-2.5 text-sm"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((current) => !current)}
          >
            Menu
          </button>
          <p className="text-sm font-semibold text-navy-950">Value CRM</p>
          {accountMenu("end")}
        </header>
        {open ? (
          <div className="fixed inset-x-0 bottom-0 top-12 z-40 md:hidden">
            <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close menu" onClick={() => setOpen(false)} />
            <div
              ref={drawerRef}
              id="mobile-nav"
              role="dialog"
              aria-modal="true"
              aria-label="Main menu"
              className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-slate-200 bg-white"
            >
              <div className="border-b border-slate-200 px-3 py-3">
                <p className="text-xs text-slate-500">Value Technologies</p>
                <p className="text-sm font-semibold text-navy-950">Value CRM</p>
              </div>
              <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Main">
                {items.map((link) => (
                  <NavLink key={link.to} to={link.to} className={({ isActive }) => navClass(isActive)}>
                    {link.label}
                  </NavLink>
                ))}
              </nav>
            </div>
          </div>
        ) : null}
        <main id="content" className="px-3 py-3 md:px-5 md:py-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
