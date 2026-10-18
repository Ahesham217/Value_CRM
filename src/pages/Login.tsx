import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Banner, Button, Field, controlClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { supabase } from "../lib/supabase";

export function LoginPage({ mode = "login" }: { mode?: "login" | "forgot" }) {
  const { session, profile, loading, blockedMessage } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && session && profile) return <Navigate to="/pis" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw resetError;
        setMessage("If this email belongs to an account, a reset link is on its way.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs uppercase tracking-wider text-slate-500">Value Technologies</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy-950">Value CRM</h1>
        <p className="mt-1 mb-5 text-sm text-slate-600">
          {mode === "forgot" ? "Request a password reset link." : "Sign in with the account an administrator created for you."}
        </p>
        {blockedMessage ? <div className="mb-3"><Banner tone="error">{blockedMessage}</Banner></div> : null}
        {error ? <div className="mb-3"><Banner tone="error">{error}</Banner></div> : null}
        {message ? <div className="mb-3"><Banner tone="success">{message}</Banner></div> : null}
        <div className="space-y-3">
          <Field label="Email">
            <input className={controlClass} type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          {mode === "login" ? (
            <Field label="Password">
              <input className={controlClass} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
          ) : null}
        </div>
        <Button className="mt-5 w-full" variant="primary" type="submit" disabled={submitting}>
          {submitting ? "Please wait…" : mode === "forgot" ? "Send reset link" : "Sign in"}
        </Button>
        <p className="mt-4 text-sm">
          {mode === "forgot" ? (
            <Link className="text-navy-800 underline" to="/login">Back to sign in</Link>
          ) : (
            <Link className="text-navy-800 underline" to="/forgot-password">Forgot password</Link>
          )}
        </p>
      </form>
    </div>
  );
}
