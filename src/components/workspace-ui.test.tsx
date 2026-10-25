import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Disclosure } from "./ui";
import { defaultCrumbs } from "./page-chrome";
import { directoryNavigation, footerNavigation, mainNavigation, workspaceNavigation } from "../lib/navigation";
import { SETTINGS_ADMIN_MESSAGE, permissionFormGroups, type PermissionCheckKey } from "../lib/user-form";
import type { PermissionFlag } from "../lib/permissions";

const applicationPaths = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/",
  "/dashboard",
  "/payments",
  "/pis",
  "/subscriptions",
  "/subscriptions/:id",
  "/pis/:id",
  "/pis/:id/edit",
  "/clients",
  "/clients/new",
  "/clients/:id",
  "/vendors",
  "/vendors/new",
  "/vendors/:id",
  "/products",
  "/products/new",
  "/products/:id",
  "/settings",
];

describe("workspace navigation", () => {
  it("keeps the signed-in routes and leaves Settings to administrators", () => {
    const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    for (const path of applicationPaths) {
      expect(source).toContain(`path="${path}"`);
    }
    expect(source).toContain('element={<Navigate to={HOME_PATH} replace />}');
    expect(workspaceNavigation().map((item) => item.label)).toEqual(["Dashboard", "Proforma invoices", "Payments", "Subscriptions"]);
    expect(directoryNavigation().map((item) => item.label)).toEqual(["Clients", "Vendors", "Products"]);
    expect(footerNavigation(false)).toEqual([]);
    expect(footerNavigation(true).map((item) => item.to)).toEqual(["/settings"]);
    expect(mainNavigation(false).some((item) => item.to === "/settings")).toBe(false);
    const settings = readFileSync(new URL("../pages/Settings.tsx", import.meta.url), "utf8");
    expect(settings).toContain("if (!profile?.is_admin)");
    expect(settings).toContain("SETTINGS_ADMIN_MESSAGE");
    expect(SETTINGS_ADMIN_MESSAGE).toBe("Only administrators can open Settings.");
  });

  it("sends detail breadcrumbs back to the parent list", () => {
    expect(defaultCrumbs("/pis/pi-1/edit")[0]).toEqual({ label: "Proforma invoices", to: "/pis" });
    expect(defaultCrumbs("/pis/pi-1")[0]).toEqual({ label: "Proforma invoices", to: "/pis" });
    expect(defaultCrumbs("/clients/client-1")[0]).toEqual({ label: "Clients", to: "/clients" });
    expect(defaultCrumbs("/dashboard")[1]?.label).toBe("Dashboard");
    expect(defaultCrumbs("/payments")[0]?.to).toBe("/pis");
  });
});

describe("permission form groups", () => {
  it("groups the existing flags without adding or duplicating one", () => {
    const flags: PermissionFlag[] = [
      "can_edit_drafts",
      "can_generate_pis",
      "can_manage_clients",
      "can_manage_vendors",
      "can_manage_products",
      "can_view_purchase_prices",
      "can_manage_payments",
      "can_reverse_payments",
      "can_activate_zero_subscriptions",
    ];
    const keys = permissionFormGroups.flatMap((group) => group.checks.map((check) => check.key));
    for (const flag of flags) {
      expect(keys.filter((key) => key === flag)).toEqual([flag]);
    }
    expect(permissionFormGroups.map((group) => group.heading)).toEqual([
      "PI access",
      "Directory management",
      "Payments",
      "Administration",
    ]);
    const account: PermissionCheckKey[] = ["is_active", "is_admin", "is_salesperson"];
    for (const key of account) expect(keys).toContain(key);
  });
});

describe("disclosures", () => {
  it("shows or hides its content without calling a save action", () => {
    let toggles = 0;
    const closed = renderToStaticMarkup(createElement(Disclosure, {
      title: "More commercial terms",
      summary: "Warranty: 12 months",
      open: false,
      onToggle: () => { toggles += 1; },
      children: "Warranty text",
    }));
    expect(closed).toContain("More commercial terms");
    expect(closed).toContain("Warranty: 12 months");
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("Warranty text");
    const open = renderToStaticMarkup(createElement(Disclosure, {
      title: "More commercial terms",
      open: true,
      onToggle: () => { toggles += 1; },
      children: "Warranty text",
    }));
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("Warranty text");
    expect(toggles).toBe(0);
  });
});
