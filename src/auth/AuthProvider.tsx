import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  blockedMessage: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error || !data || data.is_active !== true) return null;
  return data as Profile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const applySession = useCallback(async (next: Session | null) => {
    setSession(next);
    if (!next) {
      setProfile(null);
      return;
    }
    const nextProfile = await fetchProfile(next.user.id);
    if (!nextProfile) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      setBlockedMessage("This account is disabled or has not been provisioned by an administrator.");
      return;
    }
    setBlockedMessage(null);
    setProfile(nextProfile);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session) return;
    const nextProfile = await fetchProfile(session.user.id);
    if (!nextProfile) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      setBlockedMessage("This account is disabled or has not been provisioned by an administrator.");
      return;
    }
    setProfile(nextProfile);
  }, [session]);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      void applySession(data.session).finally(() => {
        if (active) setLoading(false);
      });
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setTimeout(() => {
        if (!active) return;
        void applySession(next);
      }, 0);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [applySession]);

  useEffect(() => {
    function onFocus() {
      if (session) void refreshProfile();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshProfile, session]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      blockedMessage,
      refreshProfile,
      signOut: async () => {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
      },
    }),
    [blockedMessage, loading, profile, refreshProfile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
