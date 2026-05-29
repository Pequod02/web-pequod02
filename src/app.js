const supabaseClient = window.supabase.createClient(
  window.PEQUOD02_SUPABASE.url,
  window.PEQUOD02_SUPABASE.anonKey,
);

const authView = document.querySelector("#auth-view");
const profileView = document.querySelector("#profile-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-button");
const googleLoginButton = document.querySelector("#google-login-button");
const profileForm = document.querySelector("#profile-form");
const profileButton = document.querySelector("#profile-button");
const profileLogoutButton = document.querySelector("#profile-logout-button");
const profileMessage = document.querySelector("#profile-message");
const adminLink = document.querySelector("#admin-link");
const logoutButton = document.querySelector("#logout-button");
const authMessage = document.querySelector("#auth-message");
const internalEmailDomain = "pequod02.local";

function setLoading(isLoading) {
  loginButton.disabled = isLoading;
  googleLoginButton.disabled = isLoading;
  loginButton.textContent = isLoading ? "Entrando..." : "Entrar";
}

function setProfileLoading(isLoading) {
  profileButton.disabled = isLoading;
  profileLogoutButton.disabled = isLoading;
  profileButton.textContent = isLoading ? "Guardando..." : "Guardar perfil";
}

function isInternalEmail(email) {
  return String(email || "").toLowerCase().endsWith(`@${internalEmailDomain}`);
}

function normalizeLoginIdentifier(value) {
  const identifier = String(value || "").trim().toLowerCase();

  if (!identifier || identifier.includes("@")) {
    return identifier;
  }

  const username = identifier
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return `${username}@${internalEmailDomain}`;
}

async function showDashboard(session) {
  authView.hidden = Boolean(session);
  profileView.hidden = true;
  dashboardView.hidden = !session;

  if (!session) {
    adminLink.hidden = true;
    return;
  }

  const { data } = await supabaseClient
    .from("profiles")
    .select("email,nombre,rol")
    .eq("id", session.user.id)
    .single();

  if (isInternalEmail(data?.email) || (!data?.email && isInternalEmail(session.user.email))) {
    authView.hidden = true;
    dashboardView.hidden = true;
    profileView.hidden = false;
    profileForm.elements.nombre.value = data?.nombre || session.user.user_metadata?.name || "";
    adminLink.hidden = true;
    return;
  }

  adminLink.hidden = data?.rol !== "admin";
}

function showError(message) {
  authMessage.textContent = message || "";
}

function showProfileMessage(message, isError = false) {
  profileMessage.textContent = message || "";
  profileMessage.dataset.state = isError ? "error" : "ok";
}

async function loadSession() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    showError("No se pudo comprobar la sesión.");
    await showDashboard(null);
    return;
  }

  await showDashboard(data.session);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  setLoading(true);

  const formData = new FormData(loginForm);
  const email = normalizeLoginIdentifier(formData.get("email"));
  const password = String(formData.get("password") || "");

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  setLoading(false);

  if (error) {
    showError("Usuario o contraseña no válidos.");
    return;
  }

  loginForm.reset();
  await showDashboard(data.session);
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showProfileMessage("");
  setProfileLoading(true);

  const formData = new FormData(profileForm);
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const nombre = String(formData.get("nombre") || "").trim();

  const { error: authError } = await supabaseClient.auth.updateUser({
    email,
    data: {
      name: nombre,
      full_name: nombre,
      uses_internal_email: false,
    },
  });

  if (authError) {
    setProfileLoading(false);
    showProfileMessage("No se pudo guardar el email.", true);
    return;
  }

  const { error: profileError } = await supabaseClient.rpc("complete_own_profile", {
    p_email: email,
    p_nombre: nombre || null,
  });

  setProfileLoading(false);

  if (profileError) {
    showProfileMessage("Email actualizado en Auth, pero no se pudo guardar el perfil.", true);
    return;
  }

  showProfileMessage("Perfil actualizado. Si Supabase pide confirmación, revisa tu email.");
  const { data } = await supabaseClient.auth.getSession();
  await showDashboard(data.session);
});

googleLoginButton.addEventListener("click", async () => {
  showError("");
  setLoading(true);

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname,
    },
  });

  setLoading(false);

  if (error) {
    showError("No se pudo iniciar sesión con Google.");
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  await supabaseClient.auth.signOut();
  logoutButton.disabled = false;
  await showDashboard(null);
});

profileLogoutButton.addEventListener("click", async () => {
  profileLogoutButton.disabled = true;
  await supabaseClient.auth.signOut();
  profileLogoutButton.disabled = false;
  await showDashboard(null);
});

supabaseClient.auth.onAuthStateChange((_event, session) => {
  showDashboard(session);
});

loadSession();
