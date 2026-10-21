import type { Profile } from "./types";

export type PermissionFlag =
  | "can_edit_drafts"
  | "can_generate_pis"
  | "can_manage_clients"
  | "can_manage_vendors"
  | "can_manage_products"
  | "can_view_purchase_prices"
  | "can_manage_payments"
  | "can_reverse_payments"
  | "can_activate_zero_subscriptions";

export function can(profile: Profile | null, flag: PermissionFlag): boolean {
  if (!profile?.is_active) return false;
  if (profile.is_admin) return true;
  return profile[flag] === true;
}

export function canSeeAllPis(profile: Profile | null): boolean {
  if (!profile?.is_active) return false;
  return profile.is_admin || profile.pi_visibility === "all";
}
