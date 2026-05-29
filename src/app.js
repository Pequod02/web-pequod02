const SUPABASE_URL = "https://fcuvurcffsmjbokrgntm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjdXZ1cmNmZnNtamJva3JnbnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTc5NjUsImV4cCI6MjA5NTU3Mzk2NX0.3GM9Kcf4dTID_NpalhQNvz2TR3FsIML5u7KFtnM2wiA";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const authView = document.querySelector("#auth-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-button");
const googleLoginButton = document.querySelector("#google-login-button");
const logoutButton = document.querySelector("#logout-button");
const authMessage = document.querySelector("#auth-message");

function setLoading(isLoading) {
  loginButton.disabled = isLoading;
  googleLoginButton.disabled = isLoading;
  loginButton.textContent = isLoading ? "Entrando..." : "Entrar";
}

function showDashboard(session) {
  authView.hidden = Boolean(session);
  dashboardView.hidden = !session;
}

function showError(message) {
  authMessage.textContent = message || "";
}

async function loadSession() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    showError("No se pudo comprobar la sesión.");
    showDashboard(null);
    return;
  }

  showDashboard(data.session);
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
  showDashboard(data.session);
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
  showDashboard(null);
});

supabaseClient.auth.onAuthStateChange((_event, session) => {
  showDashboard(session);
});

loadSession();
