export const HOME_PATH = "/pis";

export type NavItem = {
  to: string;
  label: string;
  end?: boolean;
};

/** PIs stay the post-login home. Dashboard and Payments are additional sidebar entries. */
export function mainNavigation(isAdmin: boolean): NavItem[] {
  return [
    ...workspaceNavigation(),
    ...directoryNavigation(),
    ...footerNavigation(isAdmin),
  ];
}

export function workspaceNavigation(): NavItem[] {
  return [
    { to: "/dashboard", label: "Dashboard", end: true },
    { to: "/pis", label: "Proforma invoices" },
    { to: "/payments", label: "Payments", end: true },
    { to: "/subscriptions", label: "Subscriptions" },
  ];
}

export function directoryNavigation(): NavItem[] {
  return [
    { to: "/clients", label: "Clients" },
    { to: "/vendors", label: "Vendors" },
    { to: "/products", label: "Products" },
  ];
}

/** Settings stays on the same route and is offered only to administrators. */
export function footerNavigation(isAdmin: boolean): NavItem[] {
  return isAdmin ? [{ to: "/settings", label: "Settings", end: true }] : [];
}
