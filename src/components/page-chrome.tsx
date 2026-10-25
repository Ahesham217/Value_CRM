import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

export type Crumb = {
  label: string;
  to?: string;
};

const SetCrumbsContext = createContext<(crumbs: Crumb[]) => void>(() => {});
const CrumbsContext = createContext<Crumb[] | null>(null);

export function PageChrome({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbsState] = useState<Crumb[] | null>(null);
  const setCrumbs = useCallback((next: Crumb[]) => {
    setCrumbsState(next.length > 0 ? next : null);
  }, []);
  return (
    <SetCrumbsContext.Provider value={setCrumbs}>
      <CrumbsContext.Provider value={crumbs}>{children}</CrumbsContext.Provider>
    </SetCrumbsContext.Provider>
  );
}

/** Replace the route breadcrumb while this page is mounted. Closing the page restores the route default. */
export function usePageCrumbs(crumbs: Crumb[]) {
  const setCrumbs = useContext(SetCrumbsContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setCrumbs(JSON.parse(key) as Crumb[]);
    return () => setCrumbs([]);
  }, [key, setCrumbs]);
}

export function defaultCrumbs(pathname: string): Crumb[] {
  if (pathname === "/dashboard") return [{ label: "Workspace", to: "/pis" }, { label: "Dashboard" }];
  if (pathname === "/payments") return [{ label: "Workspace", to: "/pis" }, { label: "Payments" }];
  if (pathname === "/pis") return [{ label: "Workspace", to: "/pis" }, { label: "Proforma invoices" }];
  if (pathname === "/subscriptions") return [{ label: "Workspace", to: "/pis" }, { label: "Subscriptions" }];
  if (/^\/subscriptions\/[^/]+$/.test(pathname)) return [{ label: "Subscriptions", to: "/subscriptions" }, { label: "Subscription" }];
  if (/^\/pis\/[^/]+\/edit$/.test(pathname)) return [{ label: "Proforma invoices", to: "/pis" }, { label: "New PI" }];
  if (/^\/pis\/[^/]+$/.test(pathname)) return [{ label: "Proforma invoices", to: "/pis" }, { label: "PI" }];
  if (pathname === "/clients") return [{ label: "Workspace", to: "/pis" }, { label: "Clients" }];
  if (pathname === "/clients/new") return [{ label: "Clients", to: "/clients" }, { label: "New client" }];
  if (/^\/clients\/[^/]+$/.test(pathname)) return [{ label: "Clients", to: "/clients" }, { label: "Client" }];
  if (pathname === "/vendors") return [{ label: "Workspace", to: "/pis" }, { label: "Vendors" }];
  if (pathname === "/vendors/new") return [{ label: "Vendors", to: "/vendors" }, { label: "New vendor" }];
  if (/^\/vendors\/[^/]+$/.test(pathname)) return [{ label: "Vendors", to: "/vendors" }, { label: "Vendor" }];
  if (pathname === "/products") return [{ label: "Workspace", to: "/pis" }, { label: "Products" }];
  if (pathname === "/products/new") return [{ label: "Products", to: "/products" }, { label: "New product" }];
  if (/^\/products\/[^/]+$/.test(pathname)) return [{ label: "Products", to: "/products" }, { label: "Product" }];
  if (pathname === "/settings") return [{ label: "Workspace", to: "/pis" }, { label: "Settings" }];
  return [{ label: "Workspace", to: "/pis" }];
}

export function BreadcrumbBar() {
  const location = useLocation();
  const override = useContext(CrumbsContext);
  const crumbs = override && override.length > 0 ? override : defaultCrumbs(location.pathname);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-[13px] text-muted">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? <span aria-hidden="true" className="text-line">/</span> : null}
              {crumb.to && !last ? (
                <Link className="truncate hover:text-ink" to={crumb.to}>{crumb.label}</Link>
              ) : (
                <span className={`truncate ${last ? "text-secondary" : ""}`}>{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
