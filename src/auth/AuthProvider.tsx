import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";
import {
  ACCOUNT_CHECK_FAILED_MESSAGE,
  DISABLED_ACCOUNT_MESSAGE,
  PROFILE_REQUEST_TIMEOUT_MS,
  decideProfileApply,
  dedupeInflight,
  interpretProfileResponse,
  withTimeout,
  type ProfileLookup,
} from "./session-guard";

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  blockedMessage: string | null;
  accountCheckError: string | null;
  refreshProfile: () => Promise<void>;
  retryAccountCheck: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
const profileRequests = new Map<string, Promise<ProfileLookup>>();

async function readProfile(userId: string): Promise<ProfileLookup> {
  try {
    const result = await withTimeout(
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      PROFILE_REQUEST_TIMEOUT_MS,
      "Account check",
    );
    return interpretProfileResponse({
      error: result.error,
      data: (result.data ?? null) as Profile | null,
    });
  } catch {
    return { kind: "unavailable" };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [accountCheckError, setAccountCheckError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const profileRef = useRef<Profile | null>(null);
  const tokenRef = useRef(0);
  const mountedRef = useRef(true);

  const finishLoading = useCallback((token: number) => {
    if (!mountedRef.current || tokenRef.current !== token) return;
    setLoading(false);
  }, []);

  const failAccountCheck = useCallback((token: number) => {
    if (!mountedRef.current || tokenRef.current !== token) return;
    setAccountCheckError(ACCOUNT_CHECK_FAILED_MESSAGE);
    setLoading(false);
  }, []);

  const applyLookup = useCallback(async (next: Session | null, token: number, lookup: ProfileLookup | null) => {
    if (!mountedRef.current || tokenRef.current !== token) return;
    if (!next) {
      sessionRef.current = null;
      profileRef.current = null;
      setSession(null);
      setProfile(null);
      return;
    }
    const decision = decideProfileApply({
      requestToken: token,
      currentToken: tokenRef.current,
      requestUserId: next.user.id,
      activeUserId: sessionRef.current?.user.id ?? null,
      lookup: lookup ?? { kind: "unavailable" },
    });
    if (decision.action === "ignore") return;
    if (decision.action === "set-profile") {
      profileRef.current = decision.profile;
      setProfile(decision.profile);
      setBlockedMessage(null);
      setAccountCheckError(null);
      return;
    }
    if (decision.action === "keep-session-unavailable") {
      if (!profileRef.current) setAccountCheckError(ACCOUNT_CHECK_FAILED_MESSAGE);
      return;
    }
    if (!mountedRef.current || tokenRef.current !== token) return;
    tokenRef.current += 1;
    sessionRef.current = null;
    profileRef.current = null;
    setBlockedMessage(DISABLED_ACCOUNT_MESSAGE);
    setAccountCheckError(null);
    setSession(null);
    setProfile(null);
    setLoading(false);
    await supabase.auth.signOut();
  }, []);

  const applySession = useCallback(async (next: Session | null, token: number) => {
    if (!mountedRef.current || tokenRef.current !== token) return;
    try {
      if (next && profileRef.current && profileRef.current.id !== next.user.id) {
        profileRef.current = null;
        setProfile(null);
      }
      sessionRef.current = next;
      setSession(next);
      if (!mountedRef.current || tokenRef.current !== token) return;
      if (!next) {
        await applyLookup(null, token, null);
        return;
      }
      const lookup = await dedupeInflight(profileRequests, next.user.id, () => readProfile(next.user.id));
      if (!mountedRef.current || tokenRef.current !== token) return;
      await applyLookup(next, token, lookup);
    } finally {
      finishLoading(token);
    }
  }, [applyLookup, finishLoading]);

  const acquireSession = useCallback(async (token: number) => {
    let result: Awaited<ReturnType<typeof supabase.auth.getSession>>;
    try {
      result = await withTimeout(supabase.auth.getSession(), PROFILE_REQUEST_TIMEOUT_MS, "Session check");
    } catch {
      failAccountCheck(token);
      return;
    }
    if (result.error) {
      failAccountCheck(token);
      return;
    }
    if (!mountedRef.current || tokenRef.current !== token) return;
    await applySession(result.data.session, token);
  }, [applySession, failAccountCheck]);

  const refreshProfile = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || !mountedRef.current) return;
    const token = ++tokenRef.current;
    try {
      const lookup = await dedupeInflight(profileRequests, current.user.id, () => readProfile(current.user.id));
      if (!mountedRef.current || tokenRef.current !== token || sessionRef.current?.user.id !== current.user.id) return;
      await applyLookup(current, token, lookup);
    } finally {
      finishLoading(token);
    }
  }, [applyLookup, finishLoading]);

  const retryAccountCheck = useCallback(async () => {
    if (!mountedRef.current) return;
    const token = ++tokenRef.current;
    setLoading(true);
    setAccountCheckError(null);
    await acquireSession(token);
  }, [acquireSession]);

  const signOut = useCallback(async () => {
    tokenRef.current += 1;
    sessionRef.current = null;
    profileRef.current = null;
    if (mountedRef.current) {
      setSession(null);
      setProfile(null);
      setAccountCheckError(null);
      setLoading(false);
    }
    await supabase.auth.signOut();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const getSessionToken = ++tokenRef.current;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      const token = ++tokenRef.current;
      setTimeout(() => {
        if (!mountedRef.current || tokenRef.current !== token) return;
        void applySession(next, token);
      }, 0);
    });
    void acquireSession(getSessionToken);
    return () => {
      data.subscription.unsubscribe();
    };
  }, [acquireSession, applySession]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    function onFocus() {
      if (!sessionRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refreshProfile();
      }, 300);
    }
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer) clearTimeout(timer);
    };
  }, [refreshProfile]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      blockedMessage,
      accountCheckError,
      refreshProfile,
      retryAccountCheck,
      signOut,
    }),
    [accountCheckError, blockedMessage, loading, profile, refreshProfile, retryAccountCheck, session, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
