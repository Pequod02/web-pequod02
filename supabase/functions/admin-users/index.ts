import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const roles = new Set(["admin", "patron", "tripulante"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getBearerToken(req: Request) {
  const header = req.headers.get("Authorization") || "";
  const [type, token] = header.split(" ");

  if (type.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function normalizeRole(value: unknown) {
  const role = String(value || "tripulante");
  return roles.has(role) ? role : null;
}

async function requireAdmin(req: Request, supabaseAdmin: ReturnType<typeof createClient>) {
  const token = getBearerToken(req);

  if (!token) {
    return { error: json({ error: "Sesion requerida." }, 401) };
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userData.user;

  if (userError || !user) {
    return { error: json({ error: "Sesion no valida." }, 401) };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("rol")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.rol !== "admin") {
    return { error: json({ error: "Acceso restringido a administradores." }, 403) };
  }

  return { user };
}

async function listAllAuthUsers(supabaseAdmin: ReturnType<typeof createClient>) {
  const users = [];
  const perPage = 1000;

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    users.push(...data.users);

    if (data.users.length < perPage) {
      break;
    }
  }

  return users;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY." }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const adminResult = await requireAdmin(req, supabaseAdmin);
  if ("error" in adminResult) {
    return adminResult.error;
  }

  try {
    if (req.method === "GET") {
      const [authUsers, profilesResult] = await Promise.all([
        listAllAuthUsers(supabaseAdmin),
        supabaseAdmin.from("profiles").select("id,email,nombre,rol,created_at"),
      ]);

      if (profilesResult.error) {
        throw profilesResult.error;
      }

      const profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
      const users = authUsers.map((authUser) => {
        const profile = profiles.get(authUser.id);

        return {
          id: authUser.id,
          email: authUser.email || profile?.email || "",
          nombre: profile?.nombre || authUser.user_metadata?.name || authUser.user_metadata?.full_name || "",
          rol: profile?.rol || "tripulante",
          created_at: profile?.created_at || authUser.created_at,
          last_sign_in_at: authUser.last_sign_in_at,
          has_profile: Boolean(profile),
        };
      });

      return json({ users });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const email = String(body.email || "").trim().toLowerCase();
      const nombre = String(body.nombre || "").trim();
      const password = String(body.password || "");
      const rol = normalizeRole(body.rol);

      if (!email || !password || !rol) {
        return json({ error: "Email, contrasena y rol son obligatorios." }, 400);
      }

      if (password.length < 6) {
        return json({ error: "La contrasena debe tener al menos 6 caracteres." }, 400);
      }

      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name: nombre,
          full_name: nombre,
          rol,
        },
      });

      if (createError || !created.user) {
        throw createError || new Error("No se pudo crear el usuario.");
      }

      const profile = {
        id: created.user.id,
        email,
        nombre: nombre || null,
        rol,
      };

      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert(profile, { onConflict: "id" });

      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(created.user.id);
        throw profileError;
      }

      return json({ user: { ...profile, created_at: created.user.created_at, has_profile: true } }, 201);
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      const id = String(body.id || "").trim();
      const rol = normalizeRole(body.rol);

      if (!id || !rol) {
        return json({ error: "ID y rol son obligatorios." }, 400);
      }

      const { data: authUser, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(id);

      if (getUserError || !authUser.user) {
        throw getUserError || new Error("No se pudo leer el usuario.");
      }

      const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(id, {
        user_metadata: {
          ...authUser.user.user_metadata,
          rol,
        },
      });

      if (updateAuthError) {
        throw updateAuthError;
      }

      const { error: updateProfileError } = await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id,
            email: authUser.user.email || "",
            rol,
          },
          { onConflict: "id" },
        );

      if (updateProfileError) {
        throw updateProfileError;
      }

      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id") || String((await req.json().catch(() => ({}))).id || "");

      if (!id) {
        return json({ error: "ID obligatorio." }, 400);
      }

      if (id === adminResult.user.id) {
        return json({ error: "No puedes darte de baja a ti mismo desde este panel." }, 400);
      }

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(id);

      if (deleteError) {
        throw deleteError;
      }

      return json({ ok: true });
    }

    return json({ error: "Metodo no permitido." }, 405);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Error inesperado." }, 500);
  }
});
