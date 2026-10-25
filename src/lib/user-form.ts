import type { PermissionFlag } from "./permissions";

export type AccountFlag = "is_active" | "is_admin" | "is_salesperson";

export type PermissionCheckKey = PermissionFlag | AccountFlag;

export type PermissionCheck = {
  key: PermissionCheckKey;
  label: string;
  hint?: string;
};

export type PermissionGroup = {
  heading: "PI access" | "Directory management" | "Payments" | "Administration";
  checks: PermissionCheck[];
};

/**
 * Presentation groups for the existing user flags.
 * Each key is still saved on its own. These groups do not add roles or a select-all control.
 */
export const permissionFormGroups: PermissionGroup[] = [
  {
    heading: "PI access",
    checks: [
      { key: "is_salesperson", label: "Can be assigned as a salesperson" },
      { key: "can_edit_drafts", label: "Create and edit drafts, revisions, and duplicates" },
      { key: "can_generate_pis", label: "Generate PIs" },
    ],
  },
  {
    heading: "Directory management",
    checks: [
      { key: "can_manage_clients", label: "Manage clients" },
      { key: "can_manage_vendors", label: "Manage vendors" },
      { key: "can_manage_products", label: "Manage products" },
      { key: "can_view_purchase_prices", label: "View purchase prices" },
    ],
  },
  {
    heading: "Payments",
    checks: [
      {
        key: "can_manage_payments",
        label: "Manage payment tracking and record receipts",
        hint: "Not granted automatically. Administrators already have this.",
      },
      { key: "can_reverse_payments", label: "Reverse receipts" },
      { key: "can_activate_zero_subscriptions", label: "Activate zero-value subscriptions" },
    ],
  },
  {
    heading: "Administration",
    checks: [
      { key: "is_active", label: "Active" },
      { key: "is_admin", label: "Administrator", hint: "An administrator can do every action." },
    ],
  },
];

export const SETTINGS_ADMIN_MESSAGE = "Only administrators can open Settings.";
