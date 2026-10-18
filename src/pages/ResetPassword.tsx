import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Banner, Button, Field, controlClass } from "../components/ui";
import { errorText } from "../lib/errors";
import { supabase } from "../lib/supabase";

export function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (sessionData.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage("Password updated. You can continue to the application.");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-navy-950">Choose a new password</h1>
        <p className="mt-1 mb-4 text-sm text-slate-600">Use the link from your reset email. It opens this page with a recovery session.</p>
        {error ? <div className="mb-3"><Banner tone="error">{error}</Banner></div> : null}
        {message ? <div className="mb-3"><Banner tone="success">{message}</Banner></div> : null}
        {!ready ? <Banner tone="info">Waiting for the recovery session from your email link.</Banner> : null}
        <div className="mt-4">
          <Field label="New password" hint="At least 8 characters.">
            <input className={controlClass} type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
        </div>
        <Button className="mt-5 w-full" variant="primary" type="submit" disabled={!ready || submitting}>
          {submitting ? "Saving…" : "Update password"}
        </Button>
        <p className="mt-4 text-sm">
          <Link className="text-navy-800 underline" to="/pis">Continue</Link>
        </p>
      </form>
    </div>
  );
}
