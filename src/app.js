const supabaseClient = window.supabase.createClient(
  window.PEQUOD02_SUPABASE.url,
  window.PEQUOD02_SUPABASE.anonKey,
);

const authView = document.querySelector("#auth-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-button");
const googleLoginButton = document.querySelector("#google-login-button");
const adminLink = document.querySelector("#admin-link");
const logoutButton = document.querySelector("#logout-button");
const authMessage = document.querySelector("#auth-message");

function setLoading(isLoading) {
  loginButton.disabled = isLoading;
  googleLoginButton.disabled = isLoading;
  loginButton.textContent = isLoading ? "Entrando..." : "Entrar";
}

async function showDashboard(session) {
  authView.hidden = Boolean(session);
  dashboardView.hidden = !session;

  if (!session) {
    adminLink.hidden = true;
    return;
  }

  const { data } = await supabaseClient
    .from("profiles")
    .select("rol")
    .eq("id", session.user.id)
    .single();

  adminLink.hidden = data?.rol !== "admin";
}

function showError(message) {
  authMessage.textContent = message || "";
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
  const email = String(formData.get("email") || "").trim();
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

supabaseClient.auth.onAuthStateChange((_event, session) => {
  showDashboard(session);
});

loadSession();
