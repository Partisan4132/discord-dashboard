const API = window.DASHBOARD_CONFIG.apiBaseUrl.replace(/\/$/, "");
const state = { section: "overview", user: null };

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function setMessage(text, type = "") {
  const element = $("#welcomeMessage");
  element.textContent = text;
  element.className = `form-message ${type}`;
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  if (response.status === 401) {
    state.user = null;
    updateConnection(false);
    throw new Error("You must log in first.");
  }

  if (!response.ok) {
    throw new Error(await response.text() || `Request failed: ${response.status}`);
  }

  return response.status === 204 ? null : response.json();
}

function updateConnection(connected, user = null) {
  $("#connectionText").textContent = connected ? "Connected" : "Not connected";
  $(".connection-dot").style.background = connected ? "#58d893" : "#f0a84b";
  $("#loginButton").textContent = connected ? "Log out" : "Log in with Discord";

  if (user) {
    $("#serverName").textContent = user.guildName || user.username || "Connected";
  }
}

function showSection(section) {
  state.section = section;
  $$(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.section === section);
  });
  $$(".page-section").forEach(page => {
    page.classList.toggle("active-section", page.id === section);
  });
  $("#pageTitle").textContent = section[0].toUpperCase() + section.slice(1);

  if (state.user) loadSection(section).catch(error => console.error(error));
}

function renderActivity(items = []) {
  const target = $("#activityFeed");
  $("#activityCount").textContent = items.length;

  if (!items.length) {
    target.innerHTML = '<div class="empty-state">No activity recorded yet.</div>';
    return;
  }

  target.innerHTML = items.slice(0, 8).map(item => `
    <div class="activity-row">
      <div><strong>${escapeHtml(item.action || item.type || "Activity")}</strong>  
<small>${escapeHtml(item.target || item.username || "Server event")}</small></div>
      <small>${formatDate(item.at || item.createdAt)}</small>
    </div>
  `).join("");
}

function renderTable(target, rows, columns) {
  if (!rows.length) {
    $(target).innerHTML = '<div class="empty-state">Nothing to display.</div>';
    return;
  }

  $(target).innerHTML = `
    <table><thead><tr>${columns.map(column => `<th>${column.label}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row => `<tr>${columns.map(column => `<td>${column.render(row)}</td>`).join("")}</tr>`).join("")}</tbody></table>
  `;
}

async function loadSection(section) {
  if (section === "overview") {
    const [status, activity, applications] = await Promise.all([
      api("/api/status"),
      api("/api/activity"),
      api("/api/applications?status=pending")
    ]);
    $("#botStatus").textContent = status.online ? "Online" : "Offline";
    $("#botStatusDetail").textContent = status.online ? "Gateway connected" : "Check DigitalOcean";
    $("#applicationCount").textContent = applications.length;
    renderActivity(activity);
  }

  if (section === "moderation") {
    const rows = await api("/api/activity");
    renderTable("#moderationTable", rows, [
      { label: "Action", render: row => escapeHtml(row.action || row.type || "Activity") },
      { label: "Target", render: row => escapeHtml(row.target || "—") },
      { label: "Operator", render: row => escapeHtml(row.moderator || row.reviewer || "—") },
      { label: "Time", render: row => formatDate(row.at || row.createdAt) }
    ]);
  }

  if (section === "welcome") {
    const settings = await api("/api/settings");
    $("#welcomeChannelId").value = settings.welcomeChannelId || "";
    $("#welcomeImageUrl").value = settings.welcomeImageUrl || "";
  }

  if (section === "applications") {
    const rows = await api("/api/applications");
    renderTable("#applicationsTable", rows, [
      { label: "Applicant", render: row => escapeHtml(row.username || row.userId || "Unknown") },
      { label: "Status", render: row => `<strong>${escapeHtml(row.status || "pending")}</strong>` },
      { label: "Submitted", render: row => formatDate(row.createdAt) },
      { label: "Action", render: row => row.status === "pending" ? `<button class="text-button application-action" data-id="${row.id}" data-decision="approved">Approve</button> <button class="text-button application-action" data-id="${row.id}" data-decision="denied">Deny</button>` : "Reviewed" }
    ]);
  }
}

async function loadUser() {
  try {
    state.user = await api("/api/me");
    updateConnection(true, state.user);
    await loadSection(state.section);
  } catch {
    updateConnection(false);
  }
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

$$('[data-section]').forEach(button => {
  button.addEventListener("click", () => showSection(button.dataset.section));
});

$$('[data-section-link]').forEach(button => {
  button.addEventListener("click", () => showSection(button.dataset.sectionLink));
});

$$('[data-action="refresh"]').forEach(button => {
  button.addEventListener("click", () => loadSection(state.section).catch(error => alert(error.message)));
});

$("#loginButton").addEventListener("click", async () => {
  if (state.user) {
    await api("/auth/logout", { method: "POST" });
    state.user = null;
    updateConnection(false);
    return;
  }
  window.location.href = `${API}/auth/discord`;
});

$("#saveWelcome").addEventListener("click", async () => {
  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        welcomeChannelId: $("#welcomeChannelId").value.trim(),
        welcomeImageUrl: $("#welcomeImageUrl").value.trim()
      })
    });
    setMessage("Welcome settings saved.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
});

document.addEventListener("click", async event => {
  const button = event.target.closest(".application-action");
  if (!button) return;

  try {
    await api(`/api/applications/${button.dataset.id}/${button.dataset.decision}`, {
      method: "POST"
    });
    await loadSection("applications");
  } catch (error) {
    alert(error.message);
  }
});

loadUser();
