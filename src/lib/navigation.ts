export const HOME_PATH = "/pis";

export type NavItem = {
  to: string;
  label: string;
  end?: boolean;
};

/** PIs stay the post-login home. Dashboard and Payments are additional sidebar entries. */
export function mainNavigation(isAdmin: boolean): NavItem[] {
  return [
    { to: "/dashboard", label: "Dashboard", end: true },
    { to: "/pis", label: "Proforma invoices" },
    { to: "/payments", label: "Payments", end: true },
    { to: "/subscriptions", label: "Subscriptions" },
    { to: "/clients", label: "Clients" },
    { to: "/vendors", label: "Vendors" },
    { to: "/products", label: "Products" },
    ...(isAdmin ? [{ to: "/settings", label: "Settings", end: true }] : []),
  ];
}
