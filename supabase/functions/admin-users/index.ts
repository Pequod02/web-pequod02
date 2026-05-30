import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.info("[admin-users] module loaded");

addEventListener("error", (event) => {
  console.error("[admin-users] uncaught error", event.error?.message || event.message);
});

addEventListener("unhandledrejection", (event) => {
  console.error("[admin-users] unhandled rejection", event.reason?.message || event.reason);
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const roles = new Set(["admin", "patron", "tripulante"]);
const internalEmailDomain = "pequod02.local";
type SupabaseAdminClient = ReturnType<typeof createClient>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function logError(scope: string, error: unknown) {
  console.error(`[admin-users] ${scope}`, error instanceof Error ? error.message : error);
}

function logSupabaseError(scope: string, error: unknown) {
  if (error && typeof error === "object") {
    const supabaseError = error as {
      code?: string;
      message?: string;
      details?: string;
      hint?: string;
    };

    console.error(`[admin-users] ${scope}`, {
      code: supabaseError.code,
      message: supabaseError.message,
      details: supabaseError.details,
      hint: supabaseError.hint,
    });
    return;
  }

  logError(scope, error);
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

function isInternalEmail(email: string) {
  return email.toLowerCase().endsWith(`@${internalEmailDomain}`);
}

function buildInternalEmail(username: string) {
  const slug = username
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 48);

  if (!slug) {
    return null;
  }

  return `${slug}@${internalEmailDomain}`;
}

function publicEmail(email: string) {
  return isInternalEmail(email) ? "" : email;
}

function createSupabaseAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

  console.info("[admin-users] env check", {
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasServiceRoleKey: Boolean(serviceRoleKey),
    serviceRoleKeyLength: serviceRoleKey?.length || 0,
  });

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Faltan variables SUPABASE_URL o SERVICE_ROLE_KEY.");
  }

  try {
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          "X-Client-Info": "pequod02-admin-users",
        },
      },
    });

    console.info("[admin-users] Supabase Admin client initialized");
    return client;
  } catch (error) {
    logError("Supabase Admin client initialization failed", error);
    throw error;
  }
}

async function requireAdmin(req: Request, serviceRoleClient: SupabaseAdminClient) {
  const token = getBearerToken(req);

  if (!token) {
    console.warn("[admin-users] missing bearer token");
    return { error: json({ error: "Sesion requerida." }, 401) };
  }

  const { data: userData, error: userError } = await serviceRoleClient.auth.getUser(token);
  const user = userData.user;

  if (userError || !user) {
    logError("session validation failed", userError || "User not found");
    return { error: json({ error: "Sesion no valida." }, 401) };
  }

  const { data: profile, error: profileError } = await serviceRoleClient
    .from("profiles")
    .select("rol")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.rol !== "admin") {
    logError("admin profile validation failed", profileError || `Rol actual: ${profile?.rol || "sin perfil"}`);
    return { error: json({ error: "Acceso restringido a administradores." }, 403) };
  }

  console.info("[admin-users] admin session validated", { userId: user.id });
  return { user };
}

async function requireUser(req: Request, serviceRoleClient: SupabaseAdminClient) {
  const token = getBearerToken(req);

  if (!token) {
    console.warn("[admin-users] missing bearer token");
    return { error: json({ error: "Sesion requerida." }, 401) };
  }

  const { data: userData, error: userError } = await serviceRoleClient.auth.getUser(token);
  const user = userData.user;

  if (userError || !user) {
    logError("session validation failed", userError || "User not found");
    return { error: json({ error: "Sesion no valida." }, 401) };
  }

  return { user };
}

async function listAllAuthUsers(serviceRoleClient: SupabaseAdminClient) {
  const users = [];
  const perPage = 1000;

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await serviceRoleClient.auth.admin.listUsers({ page, perPage });

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
  const requestPath = new URL(req.url).pathname;

  console.info("[admin-users] request received", {
    method: req.method,
    path: requestPath,
  });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let serviceRoleClient: SupabaseAdminClient;

  try {
    serviceRoleClient = createSupabaseAdminClient();
  } catch (error) {
    logError("startup failed", error);
    return json({ error: error instanceof Error ? error.message : "Error inicializando Supabase Admin." }, 500);
  }

  if (requestPath.endsWith("/complete-profile")) {
    if (req.method !== "POST") {
      return json({ error: "Metodo no permitido." }, 405);
    }

    const userResult = await requireUser(req, serviceRoleClient);
    if ("error" in userResult) {
      return userResult.error;
    }

    try {
      console.info("[admin-users] completing own profile", { userId: userResult.user.id });

      const body = await req.json();
      const email = String(body.email || "").trim().toLowerCase();
      const nombre = String(body.nombre || "").trim();

      if (
        !email ||
        isInternalEmail(email) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        return json({ error: "Email no valido." }, 400);
      }

      const { error: updateAuthError } = await serviceRoleClient.auth.admin.updateUserById(userResult.user.id, {
        email,
        email_confirm: true,
        user_metadata: {
          ...userResult.user.user_metadata,
          name: nombre,
          full_name: nombre,
          uses_internal_email: false,
        },
      });

      if (updateAuthError) {
        logError("auth email update failed", updateAuthError);
        throw updateAuthError;
      }

      const { error: profileError } = await serviceRoleClient
        .from("profiles")
        .upsert(
          {
            id: userResult.user.id,
            email,
            nombre: nombre || null,
          },
          { onConflict: "id" },
        );

      if (profileError) {
        logError("profile email update failed", profileError);
        throw profileError;
      }

      return json({ ok: true });
    } catch (error) {
      logError("complete profile failed", error);
      return json({ error: error instanceof Error ? error.message : "No se pudo guardar el perfil." }, 500);
    }
  }

  const adminResult = await requireAdmin(req, serviceRoleClient);
  if ("error" in adminResult) {
    return adminResult.error;
  }

  try {
    if (req.method === "GET") {
      console.info("[admin-users] listing users");
      const [authUsers, profilesResult] = await Promise.all([
        listAllAuthUsers(serviceRoleClient),
        serviceRoleClient.from("profiles").select("id,email,nombre,rol,created_at"),
      ]);

      if (profilesResult.error) {
        throw profilesResult.error;
      }

      const profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
      const users = authUsers.map((authUser) => {
        const profile = profiles.get(authUser.id);

        return {
          id: authUser.id,
          email: publicEmail(authUser.email || profile?.email || ""),
          username: (authUser.email || "").split("@")[0],
          nombre: profile?.nombre || authUser.user_metadata?.name || authUser.user_metadata?.full_name || "",
          rol: profile?.rol || "tripulante",
          created_at: profile?.created_at || authUser.created_at,
          last_sign_in_at: authUser.last_sign_in_at,
          has_profile: Boolean(profile),
          email_pending: isInternalEmail(authUser.email || profile?.email || ""),
        };
      });

      return json({ users });
    }

    if (req.method === "POST") {
      console.info("[admin-users] creating user");
      const body = await req.json();
      const requestedEmail = String(body.email || "").trim().toLowerCase();
      const nombre = String(body.nombre || "").trim();
      const password = String(body.password || "");
      const rol = normalizeRole(body.rol);
      const email = requestedEmail || buildInternalEmail(nombre);

      if (!email || !password || !rol) {
        return json({ error: "Nombre de usuario, contrasena y rol son obligatorios." }, 400);
      }

      if (password.length < 6) {
        return json({ error: "La contrasena debe tener al menos 6 caracteres." }, 400);
      }

      const { data: created, error: createError } = await serviceRoleClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name: nombre,
          full_name: nombre,
          rol,
          uses_internal_email: !requestedEmail,
        },
      });

      if (createError || !created.user) {
        logError("auth user creation failed", createError || "No user returned");
        throw createError || new Error("No se pudo crear el usuario.");
      }

      const profile = {
        id: created.user.id,
        email,
        nombre: nombre || null,
        rol,
      };

      const { error: profileError } = await serviceRoleClient
        .from("profiles")
        .upsert(profile, { onConflict: "id" });

      if (profileError) {
        logError("profile upsert failed after user creation", profileError);
        await serviceRoleClient.auth.admin.deleteUser(created.user.id);
        throw profileError;
      }

      return json({ user: { ...profile, created_at: created.user.created_at, has_profile: true } }, 201);
    }

    if (req.method === "PATCH") {
      console.info("[admin-users] updating user role");
      const body = await req.json().catch((error) => {
        logError("patch body parse failed", error);
        return null;
      });

      if (!body || typeof body !== "object") {
        return json({ error: "Body JSON no valido." }, 400);
      }

      const id = String(body.id || "").trim();
      const rol = normalizeRole(body.rol);

      console.info("[admin-users] patch payload", {
        hasId: Boolean(id),
        id,
        rol,
      });

      if (!id || !rol) {
        return json({ error: "ID y rol son obligatorios." }, 400);
      }

      console.info("[admin-users] reading auth user for role update", { id });
      const { data: authUser, error: getUserError } = await serviceRoleClient.auth.admin.getUserById(id);

      if (getUserError || !authUser.user) {
        logSupabaseError("auth user read failed", getUserError || "No user returned");
        throw getUserError || new Error("No se pudo leer el usuario.");
      }

      console.info("[admin-users] updating auth metadata role", { id, rol });
      const { error: updateAuthError } = await serviceRoleClient.auth.admin.updateUserById(id, {
        user_metadata: {
          ...authUser.user.user_metadata,
          rol,
        },
      });

      if (updateAuthError) {
        logSupabaseError("auth user role update failed", updateAuthError);
        throw updateAuthError;
      }

      console.info("[admin-users] updating profile role with serviceRoleClient", { id, rol });
      const { data: updatedProfile, error: updateProfileError } = await serviceRoleClient
        .from("profiles")
        .update({ rol })
        .eq("id", id)
        .select("id,email,nombre,rol,created_at")
        .single();

      if (updateProfileError) {
        logSupabaseError("profile role update failed", updateProfileError);
        throw updateProfileError;
      }

      console.info("[admin-users] profile role updated", { id, rol: updatedProfile.rol });
      return json({ ok: true, user: updatedProfile });
    }

    if (req.method === "DELETE") {
      console.info("[admin-users] deleting user");
      const url = new URL(req.url);
      const id = url.searchParams.get("id") || String((await req.json().catch(() => ({}))).id || "");

      if (!id) {
        return json({ error: "ID obligatorio." }, 400);
      }

      if (id === adminResult.user.id) {
        return json({ error: "No puedes darte de baja a ti mismo desde este panel." }, 400);
      }

      const { error: deleteError } = await serviceRoleClient.auth.admin.deleteUser(id);

      if (deleteError) {
        logError("auth user deletion failed", deleteError);
        throw deleteError;
      }

      return json({ ok: true });
    }

    return json({ error: "Metodo no permitido." }, 405);
  } catch (error) {
    logError("request failed", error);
    return json({ error: error instanceof Error ? error.message : "Error inesperado." }, 500);
  }
});
