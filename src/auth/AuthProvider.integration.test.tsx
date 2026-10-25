/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FakeSession = { user: { id: string } };
type SessionResult = { data: { session: FakeSession | null }; error: { message: string } | null };
type ProfileResult = { data: Profile | null; error: { message: string } | null };

const harness = vi.hoisted(() => {
  type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
  };
  function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const listeners: Array<(event: string, session: FakeSession | null) => void> = [];
  const sessionQueue: Array<Promise<SessionResult>> = [];
  const profileQueue: Array<Promise<ProfileResult>> = [];
  const closers: Array<() => void> = [];
  const auth = {
    getSession: () => {
      const next = sessionQueue.shift();
      if (!next) throw new Error("Unexpected getSession");
      return next;
    },
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    onAuthStateChange: (callback: (event: string, session: FakeSession | null) => void) => {
      listeners.push(callback);
      return {
        data: {
          subscription: {
            unsubscribe() {
              const index = listeners.indexOf(callback);
              if (index >= 0) listeners.splice(index, 1);
            },
          },
        },
      };
    },
  };
  return { listeners, sessionQueue, profileQueue, closers, auth, defer };
});

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: harness.auth,
    from(table: string) {
      if (table !== "profiles") throw new Error(`Unexpected table ${table}`);
      return {
        select() {
          return {
            eq(...args: string[]) {
              const userId = args[1] ?? "";
              return {
                maybeSingle() {
                  const next = harness.profileQueue.shift();
                  if (!next) throw new Error(`Unexpected profile read for ${userId}`);
                  return next;
                },
              };
            },
          };
        },
      };
    },
  },
}));

import { AuthProvider, useAuth } from "./AuthProvider";
import { ACCOUNT_CHECK_FAILED_MESSAGE, DISABLED_ACCOUNT_MESSAGE, PROFILE_REQUEST_TIMEOUT_MS } from "./session-guard";
import { RequireAuth } from "../App";
import { LoginPage } from "../pages/Login";

const seen = {
  userId: null as string | null,
  profileId: null as string | null,
  fullName: null as string | null,
  loading: false,
  accountCheckError: null as string | null,
  blockedMessage: null as string | null,
  canManagePayments: false,
  signOut: null as null | (() => Promise<void>),
};

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function profileFor(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    full_name: id,
    phone: "",
    is_active: true,
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
    ...overrides,
  };
}

function sessionResult(id: string | null, error: { message: string } | null = null): SessionResult {
  return { data: { session: id ? { user: { id } } : null }, error };
}

function queueSession(result: SessionResult) {
  harness.sessionQueue.push(Promise.resolve(result));
}

function queueProfile(result: ProfileResult) {
  harness.profileQueue.push(Promise.resolve(result));
}

function deferSession() {
  const pending = harness.defer<SessionResult>();
  harness.sessionQueue.push(pending.promise);
  harness.closers.push(() => pending.resolve(sessionResult(null, { message: "cancelled" })));
  return pending;
}

function deferProfile() {
  const pending = harness.defer<ProfileResult>();
  harness.profileQueue.push(pending.promise);
  harness.closers.push(() => pending.resolve({ data: null, error: { message: "cancelled" } }));
  return pending;
}

function Path() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname}</p>;
}

function AuthProbe() {
  const auth = useAuth();
  seen.userId = auth.session?.user.id ?? null;
  seen.profileId = auth.profile?.id ?? null;
  seen.fullName = auth.profile?.full_name ?? null;
  seen.loading = auth.loading;
  seen.accountCheckError = auth.accountCheckError;
  seen.blockedMessage = auth.blockedMessage;
  seen.canManagePayments = auth.profile?.can_manage_payments ?? false;
  seen.signOut = auth.signOut;
  return null;
}

function Home() {
  const { profile } = useAuth();
  return <h1>Signed in {profile?.full_name}</h1>;
}

function renderAuth() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/pis"]}>
        <AuthProvider>
          <Path />
          <AuthProbe />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/pis" element={<Home />} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  });
  return container;
}

async function flush() {
  await act(async () => {
    for (let step = 0; step < 8; step += 1) await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function button(container: ParentNode, label: string) {
  const found = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  return found instanceof HTMLButtonElement ? found : null;
}

async function clickRetry(container: ParentNode) {
  const retry = button(container, "Retry");
  if (!retry) throw new Error("Retry is not on screen");
  await act(async () => {
    retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let step = 0; step < 8; step += 1) await vi.advanceTimersByTimeAsync(0);
  });
}

async function signOut() {
  const run = seen.signOut;
  if (!run) throw new Error("Sign out is not available");
  await act(async () => {
    await run();
  });
}

function expectRetry(container: ParentNode) {
  expect(container.textContent).toContain(ACCOUNT_CHECK_FAILED_MESSAGE);
  expect(container.textContent).not.toContain(DISABLED_ACCOUNT_MESSAGE);
  expect(button(container, "Retry")).not.toBeNull();
  expect(container.querySelector('input[type="email"]')).toBeNull();
  expect(container.querySelector("[data-testid=path]")?.textContent).toBe("/pis");
}

describe("account check recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.sessionQueue.length = 0;
    harness.profileQueue.length = 0;
    harness.listeners.length = 0;
    harness.closers.length = 0;
    harness.auth.signOut.mockClear();
    seen.userId = null;
    seen.profileId = null;
    seen.fullName = null;
    seen.loading = false;
    seen.accountCheckError = null;
    seen.blockedMessage = null;
    seen.canManagePayments = false;
    seen.signOut = null;
  });

  afterEach(async () => {
    for (const view of mounted.splice(0)) {
      act(() => view.root.unmount());
      view.container.remove();
    }
    for (const close of harness.closers.splice(0)) close();
    harness.sessionQueue.length = 0;
    harness.profileQueue.length = 0;
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    vi.useRealTimers();
  });

  it("does not let a late retry session restore a signed-out person", async () => {
    queueSession(sessionResult("user-a"));
    queueProfile({ data: null, error: { message: "Failed to fetch" } });
    const container = renderAuth();
    await flush();
    expectRetry(container);
    expect(seen.userId).toBe("user-a");

    const pending = deferSession();
    queueProfile({ data: profileFor("user-a", { full_name: "User A" }), error: null });
    await clickRetry(container);
    expect(container.textContent).toContain("Loading…");
    expect(seen.loading).toBe(true);

    await signOut();
    expect(seen.userId).toBeNull();
    expect(seen.loading).toBe(false);
    expect(seen.accountCheckError).toBeNull();
    expect(container.querySelector('input[type="email"]')).not.toBeNull();

    await act(async () => {
      pending.resolve(sessionResult("user-a"));
    });
    await flush();

    expect(seen.userId).toBeNull();
    expect(seen.profileId).toBeNull();
    expect(seen.loading).toBe(false);
    expect(seen.accountCheckError).toBeNull();
    expect(seen.blockedMessage).toBeNull();
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(button(container, "Retry")).toBeNull();
    expect(container.textContent).not.toContain("Signed in");
    expect(harness.profileQueue).toHaveLength(1);
    expect(harness.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("does not let a late retry failure replace the signed-out screen", async () => {
    queueSession(sessionResult("user-a"));
    queueProfile({ data: null, error: { message: "Failed to fetch" } });
    const container = renderAuth();
    await flush();
    const pending = deferSession();
    await clickRetry(container);
    await signOut();

    await act(async () => {
      pending.reject(new Error("network down"));
    });
    await flush();

    expect(seen.userId).toBeNull();
    expect(seen.loading).toBe(false);
    expect(seen.accountCheckError).toBeNull();
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(button(container, "Retry")).toBeNull();
    expect(container.textContent).not.toContain(DISABLED_ACCOUNT_MESSAGE);
    expect(harness.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer session when an older retry resolves afterwards", async () => {
    queueSession(sessionResult("user-a"));
    queueProfile({ data: null, error: { message: "Failed to fetch" } });
    const container = renderAuth();
    await flush();
    const pending = deferSession();
    await clickRetry(container);

    queueProfile({ data: profileFor("user-b", { full_name: "User B" }), error: null });
    queueProfile({ data: profileFor("user-a", { full_name: "User A" }), error: null });
    const listener = harness.listeners.at(-1);
    if (!listener) throw new Error("Auth listener missing");
    await act(async () => {
      listener("SIGNED_IN", { user: { id: "user-b" } });
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(container.textContent).toContain("Signed in User B");
    expect(seen.userId).toBe("user-b");
    expect(seen.profileId).toBe("user-b");

    await act(async () => {
      pending.resolve(sessionResult("user-a"));
    });
    await flush();

    expect(container.textContent).toContain("Signed in User B");
    expect(container.textContent).not.toContain("Signed in User A");
    expect(seen.userId).toBe("user-b");
    expect(seen.profileId).toBe("user-b");
    expect(seen.accountCheckError).toBeNull();
    expect(harness.profileQueue).toHaveLength(1);
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("offers Retry when the first session lookup never resolves, and ignores the late session", async () => {
    const pending = deferSession();
    queueProfile({ data: profileFor("user-a", { full_name: "User A", is_active: false }), error: null });
    const container = renderAuth();
    await flush();
    expect(container.textContent).toContain("Loading…");
    expect(button(container, "Retry")).toBeNull();
    expect(container.querySelector('input[type="email"]')).toBeNull();

    await advance(PROFILE_REQUEST_TIMEOUT_MS);
    await flush();
    expectRetry(container);
    expect(seen.userId).toBeNull();
    expect(seen.loading).toBe(false);
    expect(harness.auth.signOut).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve(sessionResult("user-a"));
    });
    await flush();
    expectRetry(container);
    expect(seen.userId).toBeNull();
    expect(seen.blockedMessage).toBeNull();
    expect(harness.profileQueue).toHaveLength(1);
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("offers Retry when a later session lookup never resolves, and ignores the late session", async () => {
    queueSession(sessionResult(null, { message: "Failed to fetch" }));
    const container = renderAuth();
    await flush();
    expectRetry(container);

    const pending = deferSession();
    queueProfile({ data: profileFor("user-a", { full_name: "User A" }), error: null });
    await clickRetry(container);
    expect(container.textContent).toContain("Loading…");

    await advance(PROFILE_REQUEST_TIMEOUT_MS);
    await flush();
    expectRetry(container);
    expect(seen.userId).toBeNull();
    expect(seen.loading).toBe(false);
    expect(harness.auth.signOut).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve(sessionResult("user-a"));
    });
    await flush();
    expectRetry(container);
    expect(seen.userId).toBeNull();
    expect(container.textContent).not.toContain("Signed in");
    expect(harness.profileQueue).toHaveLength(1);
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("offers Retry when the session lookup is rejected", async () => {
    const pending = deferSession();
    const container = renderAuth();
    await act(async () => {
      pending.reject(new Error("network down"));
    });
    await flush();

    expectRetry(container);
    expect(seen.userId).toBeNull();
    expect(seen.loading).toBe(false);
    expect(seen.blockedMessage).toBeNull();
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("offers Retry when the profile read is rejected and keeps the session", async () => {
    queueSession(sessionResult("user-a"));
    const pending = deferProfile();
    const container = renderAuth();
    await act(async () => {
      pending.reject(new Error("profile network down"));
    });
    await flush();

    expectRetry(container);
    expect(seen.userId).toBe("user-a");
    expect(seen.profileId).toBeNull();
    expect(seen.blockedMessage).toBeNull();
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("ignores a profile that arrives after the account check has timed out and a newer retry has succeeded", async () => {
    queueSession(sessionResult("user-a"));
    const staleProfile = deferProfile();
    const container = renderAuth();
    await flush();
    await advance(PROFILE_REQUEST_TIMEOUT_MS);
    await flush();
    expectRetry(container);
    expect(seen.userId).toBe("user-a");
    expect(harness.auth.signOut).not.toHaveBeenCalled();

    queueSession(sessionResult("user-a"));
    queueProfile({ data: profileFor("user-a", { full_name: "User A ready" }), error: null });
    await clickRetry(container);
    await flush();
    expect(container.textContent).toContain("Signed in User A ready");

    await act(async () => {
      staleProfile.resolve({ data: profileFor("user-a", { full_name: "User A", is_active: false }), error: null });
    });
    await flush();
    expect(container.textContent).toContain("Signed in User A ready");
    expect(container.textContent).not.toContain(DISABLED_ACCOUNT_MESSAGE);
    expect(seen.userId).toBe("user-a");
    expect(seen.profileId).toBe("user-a");
    expect(seen.blockedMessage).toBeNull();
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("does not apply a session lookup that resolves after the provider unmounts", async () => {
    const pending = deferSession();
    queueProfile({ data: null, error: null });
    const container = renderAuth();
    await flush();
    act(() => {
      mounted.splice(0).forEach((view) => {
        view.root.unmount();
        view.container.remove();
      });
    });

    await act(async () => {
      pending.resolve(sessionResult("user-a"));
      await vi.advanceTimersByTimeAsync(PROFILE_REQUEST_TIMEOUT_MS);
    });
    expect(container.isConnected).toBe(false);
    expect(harness.profileQueue).toHaveLength(1);
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("does not sign out when a profile resolves after the provider unmounts", async () => {
    queueSession(sessionResult("user-a"));
    const pending = deferProfile();
    renderAuth();
    await flush();
    act(() => {
      mounted.splice(0).forEach((view) => {
        view.root.unmount();
        view.container.remove();
      });
    });
    await act(async () => {
      pending.resolve({ data: profileFor("user-a", { is_active: false }), error: null });
    });
    await flush();
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("signs in after a successful retry", async () => {
    queueSession(sessionResult(null, { message: "Failed to fetch" }));
    const container = renderAuth();
    await flush();
    expectRetry(container);

    queueSession(sessionResult("user-a"));
    queueProfile({ data: profileFor("user-a", { full_name: "Ada" }), error: null });
    await clickRetry(container);
    await flush();

    expect(container.textContent).toContain("Signed in Ada");
    expect(container.querySelector("[data-testid=path]")?.textContent).toBe("/pis");
    expect(button(container, "Retry")).toBeNull();
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(seen.userId).toBe("user-a");
    expect(seen.profileId).toBe("user-a");
    expect(seen.loading).toBe(false);
    expect(seen.accountCheckError).toBeNull();
    expect(seen.blockedMessage).toBeNull();
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("signs out a disabled account instead of offering Retry", async () => {
    queueSession(sessionResult("user-a"));
    queueProfile({ data: profileFor("user-a", { full_name: "Ada", is_active: false }), error: null });
    const container = renderAuth();
    await flush();

    expect(container.querySelector("[data-testid=path]")?.textContent).toBe("/login");
    expect(container.textContent).toContain(DISABLED_ACCOUNT_MESSAGE);
    expect(container.textContent).not.toContain(ACCOUNT_CHECK_FAILED_MESSAGE);
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(button(container, "Retry")).toBeNull();
    expect(container.textContent).not.toContain("Signed in");
    expect(seen.userId).toBeNull();
    expect(seen.profileId).toBeNull();
    expect(seen.accountCheckError).toBeNull();
    expect(seen.blockedMessage).toBe(DISABLED_ACCOUNT_MESSAGE);
    expect(seen.loading).toBe(false);
    expect(harness.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("shows the sign-in screen when the session lookup finds nobody", async () => {
    queueSession(sessionResult(null));
    const container = renderAuth();
    await flush();
    expect(container.querySelector("[data-testid=path]")?.textContent).toBe("/login");
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(button(container, "Retry")).toBeNull();
    expect(container.textContent).not.toContain(ACCOUNT_CHECK_FAILED_MESSAGE);
    expect(container.textContent).not.toContain(DISABLED_ACCOUNT_MESSAGE);
    expect(seen.userId).toBeNull();
    expect(seen.accountCheckError).toBeNull();
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  function expectSignedIn(container: ParentNode, name: string, userId: string) {
    expect(container.textContent).toContain(`Signed in ${name}`);
    expect(container.textContent).not.toContain("Loading…");
    expect(container.querySelector("[data-testid=path]")?.textContent).toBe("/pis");
    expect(button(container, "Retry")).toBeNull();
    expect(seen.loading).toBe(false);
    expect(seen.userId).toBe(userId);
    expect(seen.profileId).toBe(userId);
    expect(seen.fullName).toBe(name);
    expect(seen.accountCheckError).toBeNull();
    expect(seen.blockedMessage).toBeNull();
  }

  async function focusRefresh() {
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(300);
    });
  }

  it("finishes loading when a focus refresh resolves the shared profile read", async () => {
    queueSession(sessionResult("user-a"));
    const profile = deferProfile();
    const container = renderAuth();
    await flush();
    expect(container.textContent).toContain("Loading…");
    expect(seen.userId).toBe("user-a");
    expect(seen.profileId).toBeNull();
    expect(seen.loading).toBe(true);
    expect(harness.profileQueue).toHaveLength(0);

    await focusRefresh();
    expect(seen.loading).toBe(true);
    expect(harness.profileQueue).toHaveLength(0);
    expect(container.textContent).toContain("Loading…");

    await act(async () => {
      profile.resolve({ data: profileFor("user-a", { full_name: "User A" }), error: null });
    });
    await flush();
    expectSignedIn(container, "User A", "user-a");
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("finishes loading when the shared profile read times out during a focus refresh", async () => {
    queueSession(sessionResult("user-a"));
    const profile = deferProfile();
    const container = renderAuth();
    await flush();
    await focusRefresh();
    expect(seen.loading).toBe(true);

    await advance(PROFILE_REQUEST_TIMEOUT_MS);
    await flush();
    expectRetry(container);
    expect(seen.userId).toBe("user-a");
    expect(seen.profileId).toBeNull();
    expect(seen.loading).toBe(false);
    expect(harness.auth.signOut).not.toHaveBeenCalled();

    await act(async () => {
      profile.resolve({ data: profileFor("user-a", { full_name: "User A" }), error: null });
    });
    await flush();
    expectRetry(container);
    expect(seen.userId).toBe("user-a");
    expect(seen.profileId).toBeNull();
    expect(seen.loading).toBe(false);
    expect(container.textContent).not.toContain("Signed in");
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("finishes loading for a newer session before the older profile read resolves", async () => {
    queueSession(sessionResult("user-a"));
    const olderProfile = deferProfile();
    const container = renderAuth();
    await flush();
    expect(seen.loading).toBe(true);
    expect(seen.userId).toBe("user-a");

    const newerProfile = deferProfile();
    const listener = harness.listeners.at(-1);
    if (!listener) throw new Error("Auth listener missing");
    await act(async () => {
      listener("SIGNED_IN", { user: { id: "user-b" } });
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(seen.loading).toBe(true);
    expect(seen.userId).toBe("user-b");
    expect(container.textContent).toContain("Loading…");

    await act(async () => {
      newerProfile.resolve({ data: profileFor("user-b", { full_name: "User B" }), error: null });
    });
    await flush();
    expectSignedIn(container, "User B", "user-b");

    await act(async () => {
      olderProfile.resolve({ data: profileFor("user-a", { full_name: "User A", is_active: false }), error: null });
    });
    await flush();
    expectSignedIn(container, "User B", "user-b");
    expect(container.textContent).not.toContain("Signed in User A");
    expect(container.textContent).not.toContain(DISABLED_ACCOUNT_MESSAGE);
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("keeps the newer session visible when the older profile read times out", async () => {
    queueSession(sessionResult("user-a"));
    const olderProfile = deferProfile();
    const container = renderAuth();
    await flush();

    const newerProfile = deferProfile();
    const listener = harness.listeners.at(-1);
    if (!listener) throw new Error("Auth listener missing");
    await act(async () => {
      listener("SIGNED_IN", { user: { id: "user-b" } });
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      newerProfile.resolve({ data: profileFor("user-b", { full_name: "User B" }), error: null });
    });
    await flush();
    expectSignedIn(container, "User B", "user-b");

    await advance(PROFILE_REQUEST_TIMEOUT_MS);
    await flush();
    expectSignedIn(container, "User B", "user-b");
    expect(harness.auth.signOut).not.toHaveBeenCalled();

    await act(async () => {
      olderProfile.resolve({ data: profileFor("user-a", { full_name: "User A" }), error: null });
    });
    await flush();
    expectSignedIn(container, "User B", "user-b");
    expect(container.textContent).not.toContain("Signed in User A");
    expect(seen.loading).toBe(false);
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });

  it("refreshes permissions on focus without leaving the signed-in screen", async () => {
    queueSession(sessionResult("user-a"));
    queueProfile({ data: profileFor("user-a", { full_name: "Ada", can_manage_payments: false }), error: null });
    queueProfile({ data: profileFor("user-a", { full_name: "Ada", can_manage_payments: true }), error: null });
    const container = renderAuth();
    await flush();
    expect(container.textContent).toContain("Signed in Ada");
    expect(seen.canManagePayments).toBe(false);
    expect(seen.loading).toBe(false);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(seen.canManagePayments).toBe(false);
    expect(container.textContent).toContain("Signed in Ada");
    expect(container.textContent).not.toContain("Loading…");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flush();
    expect(seen.canManagePayments).toBe(true);
    expect(seen.userId).toBe("user-a");
    expect(seen.loading).toBe(false);
    expect(container.textContent).toContain("Signed in Ada");
    expect(container.textContent).not.toContain("Loading…");
    expect(harness.auth.signOut).not.toHaveBeenCalled();
  });
});
