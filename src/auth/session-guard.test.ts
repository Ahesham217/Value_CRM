import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../lib/types";
import {
  ACCOUNT_CHECK_FAILED_MESSAGE,
  DISABLED_ACCOUNT_MESSAGE,
  decideProfileApply,
  dedupeInflight,
  interpretProfileResponse,
  withTimeout,
} from "./session-guard";

function profile(active = true): Profile {
  return {
    id: "user-1",
    full_name: "Ada",
    phone: "",
    is_active: active,
    is_admin: false,
    is_salesperson: true,
    pi_visibility: "associated",
    can_edit_drafts: true,
    can_generate_pis: false,
    can_manage_clients: false,
    can_manage_vendors: false,
    can_manage_products: false,
    can_view_purchase_prices: false,
    can_manage_payments: false,
    can_reverse_payments: false,
    can_activate_zero_subscriptions: false,
  };
}

describe("profile session guard", () => {
  it("treats a transport error as unavailable rather than a disabled account", () => {
    expect(interpretProfileResponse({ error: { message: "Failed to fetch" }, data: null })).toEqual({ kind: "unavailable" });
    expect(interpretProfileResponse({ error: null, data: null })).toEqual({ kind: "inactive" });
    expect(interpretProfileResponse({ error: null, data: profile(false) })).toEqual({ kind: "inactive" });
    expect(interpretProfileResponse({ error: null, data: profile(true) }).kind).toBe("active");
    expect(DISABLED_ACCOUNT_MESSAGE).not.toBe(ACCOUNT_CHECK_FAILED_MESSAGE);
  });

  it("ignores a late profile response after sign-out or a newer session", () => {
    const active = profile();
    expect(decideProfileApply({
      requestToken: 1,
      currentToken: 2,
      requestUserId: "user-1",
      activeUserId: "user-1",
      lookup: { kind: "inactive" },
    })).toEqual({ action: "ignore" });
    expect(decideProfileApply({
      requestToken: 1,
      currentToken: 1,
      requestUserId: "user-1",
      activeUserId: null,
      lookup: { kind: "active", profile: active },
    })).toEqual({ action: "ignore" });
    expect(decideProfileApply({
      requestToken: 4,
      currentToken: 4,
      requestUserId: "user-1",
      activeUserId: "user-2",
      lookup: { kind: "active", profile: active },
    })).toEqual({ action: "ignore" });
  });

  it("signs out only the current inactive account and keeps the session when the check fails", () => {
    expect(decideProfileApply({
      requestToken: 3,
      currentToken: 3,
      requestUserId: "user-1",
      activeUserId: "user-1",
      lookup: { kind: "inactive" },
    })).toEqual({ action: "sign-out-inactive" });
    expect(decideProfileApply({
      requestToken: 3,
      currentToken: 3,
      requestUserId: "user-1",
      activeUserId: "user-1",
      lookup: { kind: "unavailable" },
    })).toEqual({ action: "keep-session-unavailable" });
    const active = profile();
    expect(decideProfileApply({
      requestToken: 3,
      currentToken: 3,
      requestUserId: "user-1",
      activeUserId: "user-1",
      lookup: { kind: "active", profile: active },
    })).toEqual({ action: "set-profile", profile: active });
  });

  it("deduplicates an equivalent in-flight profile request", async () => {
    const map = new Map<string, Promise<string>>();
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.resolve("profile");
    };
    const [first, second] = await Promise.all([
      dedupeInflight(map, "user-1", run),
      dedupeInflight(map, "user-1", run),
    ]);
    expect(first).toBe("profile");
    expect(second).toBe("profile");
    expect(calls).toBe(1);
    expect(map.size).toBe(0);
    await dedupeInflight(map, "user-1", run);
    expect(calls).toBe(2);
    await dedupeInflight(map, "user-2", run);
    expect(calls).toBe(3);
  });

  it("stops waiting when the account check does not finish", async () => {
    vi.useFakeTimers();
    const pending = new Promise<string>(() => undefined);
    const result = withTimeout(pending, 8_000, "Account check");
    const assertion = expect(result).rejects.toThrow("Account check timed out.");
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    vi.useRealTimers();
  });
});
