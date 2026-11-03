export const preservedPermissionFlags = [
  "can_manage_payments",
  "can_reverse_payments",
  "can_activate_zero_subscriptions",
  "can_review_payments",
] as const;

export type PreservedPermissionFlag = (typeof preservedPermissionFlags)[number];

export type ProfileFlagInput = {
  full_name?: string;
  phone?: string;
  is_active?: boolean;
  is_admin?: boolean;
  is_salesperson?: boolean;
  pi_visibility?: string;
  can_edit_drafts?: boolean;
  can_generate_pis?: boolean;
  can_manage_clients?: boolean;
  can_manage_vendors?: boolean;
  can_manage_products?: boolean;
  can_view_purchase_prices?: boolean;
} & Partial<Record<PreservedPermissionFlag, boolean>>;

/**
 * Profile columns written by admin-users.
 * Payment and finance flags stay as stored when an older payload omits them.
 * A payload that sends true or false still updates that flag.
 */
export function profileFlags(user: ProfileFlagInput, existing?: Record<string, unknown>): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    full_name: (user.full_name ?? "").trim(),
    phone: (user.phone ?? "").trim(),
    is_active: user.is_active !== false,
    is_admin: user.is_admin === true,
    is_salesperson: user.is_salesperson === true,
    pi_visibility: user.pi_visibility === "all" ? "all" : "associated",
    can_edit_drafts: user.can_edit_drafts === true,
    can_generate_pis: user.can_generate_pis === true,
    can_manage_clients: user.can_manage_clients === true,
    can_manage_vendors: user.can_manage_vendors === true,
    can_manage_products: user.can_manage_products === true,
    can_view_purchase_prices: user.can_view_purchase_prices === true,
  };
  for (const flag of preservedPermissionFlags) {
    if (existing && !(flag in existing)) continue;
    const requested = user[flag];
    profile[flag] = requested === undefined ? existing?.[flag] === true : requested === true;
  }
  return profile;
}
