import type { Profile } from "../lib/types";

export const PROFILE_REQUEST_TIMEOUT_MS = 8_000;
export const DISABLED_ACCOUNT_MESSAGE = "This account is disabled or has not been provisioned by an administrator.";
export const ACCOUNT_CHECK_FAILED_MESSAGE = "The account check did not finish. Your access was not changed. Retry.";

export type ProfileLookup =
  | { kind: "active"; profile: Profile }
  | { kind: "inactive" }
  | { kind: "unavailable" };

export type ProfileApplyDecision =
  | { action: "ignore" }
  | { action: "set-profile"; profile: Profile }
  | { action: "sign-out-inactive" }
  | { action: "keep-session-unavailable" };

/** A transport or server failure is not proof that the account is disabled. */
export function interpretProfileResponse(input: {
  error: { message?: string } | null;
  data: Profile | null;
}): ProfileLookup {
  if (input.error) return { kind: "unavailable" };
  if (!input.data || input.data.is_active !== true) return { kind: "inactive" };
  return { kind: "active", profile: input.data };
}

/**
 * A profile response may be applied only for the session request that is still current.
 * An older response must not sign a newer session back in or sign it out.
 */
export function decideProfileApply(input: {
  requestToken: number;
  currentToken: number;
  requestUserId: string;
  activeUserId: string | null;
  lookup: ProfileLookup;
}): ProfileApplyDecision {
  if (input.requestToken !== input.currentToken) return { action: "ignore" };
  if (input.activeUserId !== input.requestUserId) return { action: "ignore" };
  if (input.lookup.kind === "active") return { action: "set-profile", profile: input.lookup.profile };
  if (input.lookup.kind === "inactive") return { action: "sign-out-inactive" };
  return { action: "keep-session-unavailable" };
}

/** Share one in-flight promise for the same key. A later call does not start a second request. */
export function dedupeInflight<T>(map: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = run().finally(() => {
    if (map.get(key) === promise) map.delete(key);
  });
  map.set(key, promise);
  return promise;
}

export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
