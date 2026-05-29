const supabaseClient = window.supabase.createClient(
  window.PEQUOD02_SUPABASE.url,
  window.PEQUOD02_SUPABASE.anonKey,
);

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

function renderUsers(users) {
  usersTable.innerHTML = "";

  if (!users.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "No hay usuarios visibles.";
    row.append(cell);
    usersTable.append(row);
    return;
  }

  for (const user of users) {
    const row = document.createElement("tr");
    const emailCell = document.createElement("td");
    const nameCell = document.createElement("td");
    const roleCell = document.createElement("td");
    const actionsCell = document.createElement("td");
    const roleSelect = document.createElement("select");
    const editButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    emailCell.textContent = user.email;
    nameCell.textContent = user.nombre || "";
    roleSelect.setAttribute("aria-label", `Rol de ${user.email}`);

    for (const role of ["tripulante", "patron", "admin"]) {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = role;
      option.selected = user.rol === role;
      roleSelect.append(option);
    }

    editButton.className = "text-button";
    editButton.type = "button";
    editButton.textContent = "Editar";
    deleteButton.className = "text-button danger";
    deleteButton.type = "button";
    deleteButton.textContent = "Baja";

    roleCell.append(roleSelect);
    actionsCell.append(editButton, deleteButton);
    row.append(emailCell, nameCell, roleCell, actionsCell);

    editButton.addEventListener("click", () => {
      userForm.elements.id.value = user.id;
      userForm.elements.email.value = user.email;
      userForm.elements.nombre.value = user.nombre || "";
      userForm.elements.rol.value = roleSelect.value;
    });

    roleSelect.addEventListener("change", async (event) => {
      await updateUserRole(user.id, event.target.value);
    });

    deleteButton.addEventListener("click", async () => {
      await deleteUserProfile(user.id);
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
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id,email,nombre,rol,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    setMessage(userMessage, "No se pudieron cargar usuarios.", true);
    return;
  }

  renderUsers(data || []);
}

async function updateUserRole(id, rol) {
  const { error } = await supabaseClient
    .from("profiles")
    .update({ rol })
    .eq("id", id);

  if (error) {
    setMessage(userMessage, "No se pudo actualizar el rol.", true);
    await loadUsers();
    return;
  }

  setMessage(userMessage, "Rol actualizado.");
  await loadStats();
}

async function deleteUserProfile(id) {
  const { error } = await supabaseClient
    .from("profiles")
    .delete()
    .eq("id", id);

  if (error) {
    setMessage(userMessage, "No se pudo dar de baja el perfil.", true);
    return;
  }

  setMessage(userMessage, "Perfil dado de baja.");
  await Promise.all([loadUsers(), loadStats()]);
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
  const profile = {
    id: String(formData.get("id") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    nombre: String(formData.get("nombre") || "").trim() || null,
    rol: String(formData.get("rol") || "tripulante"),
  };

  const { error } = await supabaseClient
    .from("profiles")
    .upsert(profile, { onConflict: "id" });

  if (error) {
    setMessage(userMessage, "No se pudo guardar el usuario. Comprueba que el ID existe en Auth.", true);
    return;
  }

  userForm.reset();
  setMessage(userMessage, "Usuario guardado.");
  await Promise.all([loadUsers(), loadStats()]);
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
