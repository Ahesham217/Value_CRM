import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Visibility = "all" | "associated";

type UserInput = {
  id?: string;
  email?: string;
  full_name?: string;
  phone?: string;
  is_active?: boolean;
  is_admin?: boolean;
  is_salesperson?: boolean;
  pi_visibility?: Visibility;
  can_edit_drafts?: boolean;
  can_generate_pis?: boolean;
  can_manage_clients?: boolean;
  can_manage_vendors?: boolean;
  can_manage_products?: boolean;
  can_view_purchase_prices?: boolean;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function flags(user: UserInput) {
  return {
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
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete." }, 500);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Sign in required." }, 401);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Sign in required." }, 401);

  const admin = createClient(url, serviceKey);
  const { data: caller, error: callerError } = await admin
    .from("profiles")
    .select("is_admin, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (callerError) return json({ error: callerError.message }, 400);
  if (!caller?.is_admin || !caller.is_active) return json({ error: "Only an active administrator can manage users." }, 403);

  const body = await req.json().catch(() => null) as { action?: string; user?: UserInput; password?: string; redirect_to?: string } | null;
  if (!body?.action) return json({ error: "Missing action." }, 400);

  if (body.action === "list") {
    const { data: profileRows, error: profileError } = await admin.from("profiles").select("*").order("full_name");
    if (profileError) return json({ error: profileError.message }, 400);
    const emails = new Map<string, string>();
    for (let page = 1; page <= 20; page += 1) {
      const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listError) return json({ error: listError.message }, 400);
      for (const user of listed.users) emails.set(user.id, user.email ?? "");
      if (listed.users.length < 200) break;
    }
    return json({
      users: (profileRows ?? []).map((profile) => ({
        ...profile,
        email: emails.get(profile.id) ?? "",
      })),
    });
  }

  const input = body.user ?? {};
  const profile = flags(input);
  if (!profile.full_name) return json({ error: "Name is required." }, 400);

  async function activeAdminCount(exceptId?: string): Promise<number> {
    const { count, error } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_admin", true)
      .eq("is_active", true)
      .neq("id", exceptId ?? "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async function revokeSessions(userId: string): Promise<void> {
    const { error } = await admin.rpc("revoke_user_sessions", { p_user_id: userId });
    if (error) throw new Error(error.message);
  }

  try {
    if (body.action === "invite" || body.action === "create") {
      const email = (input.email ?? "").trim().toLowerCase();
      if (!email) return json({ error: "Email is required." }, 400);
      if (body.action === "create" && (body.password ?? "").length < 8) {
        return json({ error: "Temporary password must be at least 8 characters." }, 400);
      }
      const created = body.action === "invite"
        ? await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: profile.full_name, phone: profile.phone },
          redirectTo: body.redirect_to,
        })
        : await admin.auth.admin.createUser({
          email,
          password: body.password ?? "",
          email_confirm: true,
          user_metadata: { full_name: profile.full_name, phone: profile.phone },
        });
      if (created.error || !created.data.user) return json({ error: created.error?.message ?? "User was not created." }, 400);
      const { error: updateError } = await admin.from("profiles").update(profile).eq("id", created.data.user.id);
      if (updateError) return json({ error: updateError.message }, 400);
      return json({ id: created.data.user.id });
    }

    if (body.action === "update") {
      if (!input.id) return json({ error: "User id is required." }, 400);
      const { data: existing, error: existingError } = await admin.from("profiles").select("is_admin, is_active").eq("id", input.id).maybeSingle();
      if (existingError || !existing) return json({ error: existingError?.message ?? "User not found." }, 404);
      const removingLastAdmin = existing.is_admin && existing.is_active && (!profile.is_admin || !profile.is_active);
      if (removingLastAdmin && await activeAdminCount(input.id) === 0) {
        return json({ error: "The last active administrator cannot be removed." }, 400);
      }
      const { error: updateError } = await admin.from("profiles").update(profile).eq("id", input.id);
      if (updateError) return json({ error: updateError.message }, 400);
      if (!profile.is_active) {
        await admin.auth.admin.updateUserById(input.id, { ban_duration: "876000h" });
        await revokeSessions(input.id);
      } else {
        await admin.auth.admin.updateUserById(input.id, { ban_duration: "none" });
      }
      return json({ id: input.id });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "User administration failed.";
    return json({ error: message }, 400);
  }
});
