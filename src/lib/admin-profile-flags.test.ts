import { describe, expect, it } from "vitest";
import { profileFlags } from "../../supabase/functions/admin-users/profile-flags.ts";

describe("admin profile flags", () => {
  it("keeps the finance review permission when an older update omits it", () => {
    const saved = profileFlags(
      { full_name: "Ada", can_manage_payments: true },
      {
        can_manage_payments: false,
        can_reverse_payments: true,
        can_activate_zero_subscriptions: false,
        can_review_payments: true,
      },
    );
    expect(saved.can_review_payments).toBe(true);
    expect(saved.can_manage_payments).toBe(true);
    expect(saved.can_reverse_payments).toBe(true);
    expect(saved.can_activate_zero_subscriptions).toBe(false);
  });

  it("stores an explicit finance review choice", () => {
    const saved = profileFlags(
      { full_name: "Ada", can_review_payments: false },
      { can_review_payments: true, can_manage_payments: false, can_reverse_payments: false, can_activate_zero_subscriptions: false },
    );
    expect(saved.can_review_payments).toBe(false);
  });

  it("does not send the new flag when the stored profile has no such column", () => {
    const saved = profileFlags(
      { full_name: "Ada", can_review_payments: true },
      { can_manage_payments: true, can_reverse_payments: false, can_activate_zero_subscriptions: false },
    );
    expect(saved).not.toHaveProperty("can_review_payments");
    expect(saved.can_manage_payments).toBe(true);
  });

  it("leaves a new user's omitted finance permission false when the column already exists", () => {
    const saved = profileFlags(
      { full_name: "Ada" },
      { can_manage_payments: false, can_reverse_payments: false, can_activate_zero_subscriptions: false, can_review_payments: false },
    );
    expect(saved.can_review_payments).toBe(false);
    expect(saved.can_manage_payments).toBe(false);
    expect(saved.can_view_purchase_prices).toBe(false);
  });
});
