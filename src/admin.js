const supabaseClient = window.supabase.createClient(
  window.PEQUOD02_SUPABASE.url,
  window.PEQUOD02_SUPABASE.anonKey,
);

const adminUsersUrl = `${window.PEQUOD02_SUPABASE.url}/functions/v1/admin-users`;

const gate = document.querySelector("#admin-gate");
const adminPanel = document.querySelector("#admin-panel");
const logoutButton = document.querySelector("#logout-button");
const userForm = document.querySelector("#user-form");
const userMessage = document.querySelector("#user-message");
const usersTable = document.querySelector("#users-table");
const refreshUsersButton = document.querySelector("#refresh-users");
const uploadForm = document.querySelector("#upload-form");
const uploadMessage = document.querySelector("#upload-message");
const filesList = document.querySelector("#files-list");

const stats = {
  users: document.querySelector("#stat-users"),
  admins: document.querySelector("#stat-admins"),
  patrons: document.querySelector("#stat-patrons"),
  files: document.querySelector("#stat-files"),
};

function setGate(message) {
  gate.textContent = message;
}

function setMessage(element, message, isError = false) {
  element.textContent = message || "";
  element.dataset.state = isError ? "error" : "ok";
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

async function getAccessToken() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error || !data.session) {
    throw new Error("Sesion requerida.");
  }

  return data.session.access_token;
}

async function adminUsersRequest(method, payload = null) {
  const token = await getAccessToken();
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      apikey: window.PEQUOD02_SUPABASE.anonKey,
      "Content-Type": "application/json",
    },
  };

  let url = adminUsersUrl;

  if (payload && method === "DELETE") {
    url = `${adminUsersUrl}?id=${encodeURIComponent(payload.id)}`;
  } else if (payload) {
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "No se pudo completar la operacion.");
  }

  return data;
}

function renderUsers(users) {
  usersTable.innerHTML = "";

  if (!users.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No hay usuarios registrados.";
    row.append(cell);
    usersTable.append(row);
    return;
  }

  for (const user of users) {
    const row = document.createElement("tr");
    const emailCell = document.createElement("td");
    const nameCell = document.createElement("td");
    const roleCell = document.createElement("td");
    const createdCell = document.createElement("td");
    const actionsCell = document.createElement("td");
    const roleSelect = document.createElement("select");
    const saveButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    emailCell.textContent = user.email || "Pendiente";
    if (!user.email) {
      emailCell.className = "muted-cell";
    }
    nameCell.textContent = user.nombre || "";
    createdCell.textContent = formatDate(user.created_at);
    roleSelect.setAttribute("aria-label", `Rol de ${user.email || user.nombre || user.username}`);

    for (const role of ["tripulante", "patron", "admin"]) {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = role;
      option.selected = user.rol === role;
      roleSelect.append(option);
    }

    saveButton.className = "text-button";
    saveButton.type = "button";
    saveButton.textContent = "Guardar";
    deleteButton.className = "text-button danger";
    deleteButton.type = "button";
    deleteButton.textContent = "Baja";

    roleCell.append(roleSelect);
    actionsCell.append(saveButton, deleteButton);
    row.append(emailCell, nameCell, roleCell, createdCell, actionsCell);

    saveButton.addEventListener("click", async () => {
      await updateUserRole(user.id, roleSelect.value);
    });

    roleSelect.addEventListener("change", async (event) => {
      await updateUserRole(user.id, event.target.value);
    });

    deleteButton.addEventListener("click", async () => {
      const label = user.email || user.nombre || user.username;
      const confirmed = window.confirm(`Dar de baja a ${label}? Se eliminara de Supabase Auth.`);

      if (confirmed) {
        await deleteUser(user.id);
      }
    });

    usersTable.append(row);
  }
}

function renderFiles(files) {
  filesList.innerHTML = "";

  if (!files.length) {
    const item = document.createElement("li");
    item.textContent = "No hay archivos subidos.";
    filesList.append(item);
    return;
  }

  for (const file of files) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const date = document.createElement("small");

    name.textContent = file.name;
    date.textContent = new Date(file.created_at).toLocaleString("es-ES");
    item.append(name, date);
    filesList.append(item);
  }
}

async function requireAdmin() {
  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();

  if (sessionError || !sessionData.session) {
    window.location.href = "../index.html";
    return null;
  }

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("rol")
    .eq("id", sessionData.session.user.id)
    .single();

  if (error || profile?.rol !== "admin") {
    adminPanel.hidden = true;
    setGate("Acceso restringido. Esta página requiere rol admin.");
    return null;
  }

  gate.hidden = true;
  adminPanel.hidden = false;
  return sessionData.session;
}

async function loadStats() {
  const { data, error } = await supabaseClient.rpc("admin_basic_stats");

  if (error || !data?.length) {
    return;
  }

  const [row] = data;
  stats.users.textContent = row.total_usuarios ?? 0;
  stats.admins.textContent = row.total_admins ?? 0;
  stats.patrons.textContent = row.total_patrones ?? 0;
  stats.files.textContent = row.total_archivos ?? 0;
}

async function loadUsers() {
  try {
    const { users } = await adminUsersRequest("GET");
    renderUsers(users || []);
  } catch (error) {
    setMessage(userMessage, error.message || "No se pudieron cargar usuarios.", true);
  }
}

async function updateUserRole(id, rol) {
  try {
    await adminUsersRequest("PATCH", { id, rol });
    setMessage(userMessage, "Rol actualizado.");
    await Promise.all([loadUsers(), loadStats()]);
  } catch (error) {
    setMessage(userMessage, error.message || "No se pudo actualizar el rol.", true);
    await loadUsers();
  }
}

async function deleteUser(id) {
  try {
    await adminUsersRequest("DELETE", { id });
    setMessage(userMessage, "Usuario dado de baja.");
    await Promise.all([loadUsers(), loadStats()]);
  } catch (error) {
    setMessage(userMessage, error.message || "No se pudo dar de baja el usuario.", true);
  }
}

async function loadFiles() {
  const { data, error } = await supabaseClient.storage
    .from("pequod02-files")
    .list("", { limit: 100, sortBy: { column: "created_at", order: "desc" } });

  if (error) {
    setMessage(uploadMessage, "No se pudieron cargar archivos.", true);
    return;
  }

  renderFiles(data || []);
}

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(userMessage, "");

  const formData = new FormData(userForm);
  const user = {
    email: String(formData.get("email") || "").trim(),
    nombre: String(formData.get("nombre") || "").trim(),
    password: String(formData.get("password") || ""),
    rol: String(formData.get("rol") || "tripulante"),
  };

  try {
    await adminUsersRequest("POST", user);
    userForm.reset();
    setMessage(userMessage, "Usuario creado en Auth y profiles.");
    await Promise.all([loadUsers(), loadStats()]);
  } catch (error) {
    setMessage(userMessage, error.message || "No se pudo crear el usuario.", true);
  }
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(uploadMessage, "");

  const file = uploadForm.elements.file.files[0];
  if (!file) {
    setMessage(uploadMessage, "Selecciona un archivo.", true);
    return;
  }

  const path = `${Date.now()}-${file.name}`;
  const { error } = await supabaseClient.storage
    .from("pequod02-files")
    .upload(path, file, { upsert: false });

  if (error) {
    setMessage(uploadMessage, "No se pudo subir el archivo.", true);
    return;
  }

  uploadForm.reset();
  setMessage(uploadMessage, "Archivo subido.");
  await Promise.all([loadFiles(), loadStats()]);
});

refreshUsersButton.addEventListener("click", loadUsers);

logoutButton.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "../index.html";
});

requireAdmin().then((session) => {
  if (!session) {
    return;
  }

  Promise.all([loadUsers(), loadFiles(), loadStats()]);
});
