import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

const links = [
  { to: "/pis", label: "PIs" },
  { to: "/clients", label: "Clients" },
  { to: "/vendors", label: "Vendors" },
  { to: "/products", label: "Products" },
];

export function Shell() {
  const { profile, signOut } = useAuth();
  return (
    <div className="min-h-screen md:pl-60">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-navy-950 text-white md:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <p className="text-xs uppercase tracking-wider text-slate-300">Value Technologies</p>
          <p className="text-lg font-semibold">Value CRM</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${isActive ? "bg-white/15 font-semibold" : "text-slate-200 hover:bg-white/10"}`
              }
            >
              {link.label}
            </NavLink>
          ))}
          {profile?.is_admin ? (
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${isActive ? "bg-white/15 font-semibold" : "text-slate-200 hover:bg-white/10"}`
              }
            >
              Settings
            </NavLink>
          ) : null}
        </nav>
        <div className="border-t border-white/10 p-4 text-sm">
          <p className="font-medium">{profile?.full_name}</p>
          <p className="text-slate-300">{profile?.is_admin ? "Administrator" : "Member"}</p>
          <button type="button" className="mt-3 text-slate-200 underline" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="font-semibold text-navy-950">Value CRM</p>
          <button type="button" className="text-sm text-navy-900" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3" aria-label="Main">
          {[...links, ...(profile?.is_admin ? [{ to: "/settings", label: "Settings" }] : [])].map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `shrink-0 rounded-full px-3 py-1 text-sm ${isActive ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-700"}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main id="content" className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
}
