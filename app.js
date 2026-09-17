const API = String(window.DASHBOARD_CONFIG?.apiBaseUrl || "").replace(/\/$/, "");

const state = {
  section: "overview",
  user: null,
  settings: null,
  channels: { channels: [], roles: [] },
  selectedTypeId: null,
  session: localStorage.getItem("dashboard_session") || "",
  guildId: localStorage.getItem("dashboard_guild_id") || "",
  servers: [],
  serversLoading: false,
  serverError: null,
  extraPanels: [],
  selectedExtraPanelId: null,
  access: null,
  userId: "",
  hiddenGuildIds: JSON.parse(localStorage.getItem("dashboard_hidden_guilds") || "[]"),
  showHiddenServers: false,
  serverAccess: {}
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(path, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const requestHeaders = {
    "Content-Type": "application/json",
    ...(state.session ? { Authorization: `Bearer ${state.session}` } : {}),
    ...(state.guildId ? { "X-Guild-Id": state.guildId } : {}),
    ...headers
  };
  const response = await fetch(`${API}${path}`, {
    ...requestOptions,
    credentials: "include",
    headers: requestHeaders
  });
  if (response.status === 401) {
    state.user = null;
    state.session = "";
    localStorage.removeItem("dashboard_session");
    updateConnection(false);
    throw new Error("Login required.");
  }
  if (!response.ok) {
    let detail = await response.text();
    try { detail = JSON.parse(detail).error || detail; } catch {}
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function decodeSessionJWT() {
  const session = localStorage.getItem("dashboard_session");
  if (!session) return null;
  const parts = session.split(".");
  if (parts.length === 3) {
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
      const payload = JSON.parse(atob(base64 + padding));
      return payload;
    } catch { return null; }
  }
  if (parts.length === 2) {
    try {
      const base64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
      const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
      const payload = JSON.parse(atob(base64 + padding));
      return payload;
    } catch { return null; }
  }
  return null;
}

function formatDuration(seconds) {
  const total = Number(seconds || 0);
  if (!Number.isFinite(total) || total <= 0) return "—";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  return [hours && `${hours}h`, minutes && `${minutes}m`, secs && `${secs}s`].filter(Boolean).join(" ") || "0s";
}
function relativeDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (!days) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function message(element, text, type = "") {
  if (!element) return;
  element.textContent = text;
  element.className = `form-message ${type}`;
}

function updateConnection(connected, user = state.user) {
  if ($("#connectionText")) $("#connectionText").textContent = connected ? "Connected" : "Not connected";
  if ($(".connection-dot")) $(".connection-dot").style.background = connected ? "#58d893" : "#f0a84b";
  if ($("#loginButton")) $("#loginButton").textContent = connected ? "Log out" : "Log in with Discord";
  if (user) {
    if ($("#serverName")) $("#serverName").textContent = user.guildName || "Connected server";
    if ($("#sidebarServerName")) $("#sidebarServerName").textContent = user.guildName || "Connected server";
  }
}

function showAuthError(error) {
  let element = $("#authError");
  if (!element) {
    element = document.createElement("div");
    element.id = "authError";
    element.className = "form-message error";
    $("#loginButton")?.parentElement?.appendChild(element);
  }
  message(element, error?.message || "Dashboard authentication failed.", "error");
}

function renderServerPicker() {
  const menu = $("#serverPickerMenu");
  if (!menu) return;
  const loadingIndicator = state.serversLoading
    ? '<div class="empty-state" style="padding:10px 12px;color:var(--muted);font-size:11px;text-align:center">Loading servers…</div>'
    : "";
  if (state.serverError && !state.serversLoading) {
    menu.innerHTML = `<div class="empty-state" style="color:var(--danger)">${escapeHtml(state.serverError)}<br><button type="button" class="primary" data-retry-servers style="margin-top:8px">Retry</button></div>`;
    $("#serverPickerButton")?.setAttribute("aria-expanded", "true");
    return;
  }
  const hidden = new Set(state.hiddenGuildIds);
  const visibleServers = state.servers.filter(server => state.showHiddenServers || !hidden.has(server.id));
  const serverMarkup = visibleServers.map(server => {
    const selected = server.id === state.guildId;
    const action = server.botInstalled ? ` data-server-id="${escapeHtml(server.id)}"` : ` data-invite-url="${escapeHtml(server.inviteUrl || "")}"`;
    const icon = server.icon ? `<img src="https://cdn.discordapp.com/icons/${escapeHtml(server.id)}/${escapeHtml(server.icon)}.png?size=64" alt="" />` : escapeHtml((server.name || "?").slice(0, 1).toUpperCase());
    return `<div class="server-option ${selected ? "selected" : ""}" ${action}>
      <span class="server-option-icon">${icon}</span>
      <span class="server-option-copy">
        <strong>${escapeHtml(server.name)}</strong>
        <small>${server.botInstalled ? `${escapeHtml(server.accessRole || "admin")} · Installed` : "Bot not installed"}</small>
      </span>
      ${server.botInstalled ? "<span class=\"server-check\">✓</span>" : `<a class="server-invite" href="${escapeHtml(server.inviteUrl || "#")}" target="_blank" rel="noopener">Invite bot</a>`}
      ${state.showHiddenServers && hidden.has(server.id) ? `<button class="server-hide-button" type="button" data-unhide-server-id="${escapeHtml(server.id)}">Unhide</button>` : `<button class="server-hide-button" type="button" data-hide-server-id="${escapeHtml(server.id)}">Hide</button>`}
    </div>`;
  }).join("");
  const hiddenToggle = state.hiddenGuildIds.length
    ? `<button class="server-hidden-toggle" type="button" data-show-hidden="true">${state.showHiddenServers ? "Hide hidden servers" : `Show hidden servers (${state.hiddenGuildIds.length})`}</button>`
    : "";
  const reauthButton = `<button class="server-hidden-toggle" type="button" data-reauth="true" style="margin-top:6px;font-size:10px;opacity:.7">Re-authenticate (refresh bot status)</button>`;
  menu.innerHTML = `${loadingIndicator}${serverMarkup || '<div class="empty-state">No administrator-accessible servers found.</div>'}${hiddenToggle}${reauthButton}`;
  $("#serverPickerButton")?.setAttribute("aria-expanded", menu.classList.contains("open") ? "true" : "false");
}

function toggleServerMenu(force) {
  const menu = $("#serverPickerMenu");
  if (!menu) return;
  const open = typeof force === "boolean" ? force : !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  renderServerPicker();
}

async function loadServers() {
  state.serversLoading = true;
  state.serverError = null;
  renderServerPicker();

  const payload = decodeSessionJWT();
  const jwtGuilds = payload?.guilds || [];

  if (jwtGuilds.length > 0 && jwtGuilds[0]?.id) {
    const clientId = window.DASHBOARD_CONFIG?.discordClientId || "";
    const hidden = new Set(state.hiddenGuildIds);

    state.servers = jwtGuilds.map(guild => {
      return {
        id: guild.id,
        name: guild.name || "Unknown Server",
        icon: guild.icon || null,
        botInstalled: guild.botInstalled !== undefined ? guild.botInstalled : false,
        inviteUrl: guild.botInstalled ? null : (clientId ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8` : null),
        accessRole: guild.accessRole || "member",
        permissions: guild.permissions || {}
      };
    }).filter(server => server.permissions?.serverSwitch !== false || server.accessRole === "owner");

    const available = state.servers.find(server => server.id === state.guildId && !hidden.has(server.id))
      || state.servers.find(server => !hidden.has(server.id));
    if (available && available.id !== state.guildId) {
      state.guildId = available.id;
      localStorage.setItem("dashboard_guild_id", state.guildId);
    }
    state.serversLoading = false;
    renderServerPicker();
    return;
  }

  try {
    const result = await api("/api/servers");
    state.servers = (result.servers || []).filter(server => server.permissions?.serverSwitch !== false || server.accessRole === "owner");
    const available = state.servers.find(server => server.id === state.guildId && server.botInstalled && !state.hiddenGuildIds.includes(server.id))
      || state.servers.find(server => server.id === result.selectedGuildId && server.botInstalled && !state.hiddenGuildIds.includes(server.id))
      || state.servers.find(server => server.botInstalled && !state.hiddenGuildIds.includes(server.id))
      || state.servers.find(server => !state.hiddenGuildIds.includes(server.id));
    if (available && available.id !== state.guildId) {
      state.guildId = available.id;
      localStorage.setItem("dashboard_guild_id", state.guildId);
    }
    renderServerPicker();
  } catch (error) {
    state.serverError = error?.message || "Failed to load servers.";
    renderServerPicker();
  } finally {
    state.serversLoading = false;
  }
}

async function switchServer(guildId) {
  const server = state.servers.find(item => item.id === guildId);
  if (!server) return;
  if (!server.botInstalled) {
    if (server.inviteUrl) window.open(server.inviteUrl, "_blank", "noopener");
    return;
  }
  state.guildId = guildId;
  localStorage.setItem("dashboard_guild_id", guildId);
  if ($("#sidebarServerName")) $("#sidebarServerName").textContent = server.name;
  if ($("#serverName")) $("#serverName").textContent = server.name;
  toggleServerMenu(false);
  await refreshDashboard();
}

async function refreshDashboard() {
  try {
    state.user = await api("/api/me");
    state.userId = state.user?.id || state.user?.userId || "";
    updateConnection(true, state.user);
  } catch (error) {
    console.error("Dashboard auth check failed:", error);
    updateConnection(false);
    showAuthError(error);
    return;
  }
  try { await loadServers(); } catch (error) { console.error("Failed to load servers during refresh:", error); }
  try { await loadSection(state.section); } catch (error) { showAuthError(error); }
}

function showSection(section) {
  state.section = section;
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.section === section));
  $$(".page-section").forEach(item => item.classList.toggle("active-section", item.id === section));
  const titles = { overview: "Overview", applications: "Applications", panels: "Panels", pending: "Pending applications", welcome: "Welcome", settings: "Settings" };
  if ($("#pageTitle")) $("#pageTitle").textContent = titles[section] || "Dashboard";
  if (state.user) loadSection(section).catch(showAuthError);
}

function renderActivity(items = []) {
  if ($("#activityCount")) $("#activityCount").textContent = items.length;
  if (!$("#activityFeed")) return;
  $("#activityFeed").innerHTML = items.length
    ? items.slice(0, 12).map(item => `<div class="activity-row"><div><strong>${escapeHtml(item.action || item.type || "Activity")}</strong><small>${escapeHtml(item.target || item.username || "Server event")}</small></div><small>${formatDate(item.at || item.createdAt)}</small></div>`).join("")
    : '<div class="empty-state">No activity recorded yet.</div>';
}

function renderApplications(rows = []) {
  if (!$("#applicationsList")) return;
  const pending = rows.filter(row => row.status === "pending");
  $("#applicationsList").innerHTML = pending.length
    ? pending.map(row => {
        const stats = row.submissionStats || row.stats || {};
        const answers = Array.isArray(row.answers) ? row.answers : [];
        const applicant = row.username || row.user?.username || row.userId || "Unknown applicant";
        return `<article class="application-card" data-application-id="${escapeHtml(row.id)}">
          <div class="application-card-head"><div><p class="eyebrow">${escapeHtml(row.typeName || row.typeId || "Application")} application submitted</p><h3>${escapeHtml(applicant)}'s application</h3><p class="application-user">User: ${escapeHtml(row.userMention || row.mention || row.userId || "—")}</p></div><span class="status">${escapeHtml(row.status || "Pending")}</span></div>
          <div class="answer-list">${answers.length ? answers.map((item, index) => `<div class="answer-item"><div class="answer-question">${index + 1}. ${escapeHtml(item.question || item.label || `Question ${index + 1}`)}</div><div class="answer-value">${escapeHtml(item.answer || "(no answer)")}</div></div>`).join("") : '<div class="empty-state">No answers were recorded.</div>'}</div>
          <div class="submission-stats"><p class="eyebrow">Submission stats</p><div class="stats-grid"><div><span>User ID</span><strong>${escapeHtml(row.userId || "—")}</strong></div><div><span>Username</span><strong>${escapeHtml(applicant)}</strong></div><div><span>Duration</span><strong>${escapeHtml(formatDuration(row.durationSeconds ?? stats.durationSeconds))}</strong></div><div><span>Joined guild</span><strong>${escapeHtml(relativeDate(row.joinedAt ?? stats.joinedAt))}</strong></div><div><span>Submitted</span><strong>${escapeHtml(formatDate(row.submittedAt ?? row.createdAt))}</strong></div></div></div>
          <div class="application-actions"><button class="primary application-action" data-id="${escapeHtml(row.id)}" data-decision="approved">Accept application</button><button class="danger application-action" data-id="${escapeHtml(row.id)}" data-decision="denied">Deny application</button></div>
        </article>`;
      }).join("")
    : '<div class="empty-state">There are no pending applications.</div>';
}

function options(items = [], selected, emptyLabel) {
  return `<option value="">${escapeHtml(emptyLabel)}</option>` + items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
}
function channelOptions(selected, emptyLabel) { return options(state.channels.channels || [], selected, emptyLabel); }
function roleOptions(selected, emptyLabel) { return options(state.channels.roles || [], selected, emptyLabel); }
function selectedType() { return (state.settings?.applicationTypes || []).find(type => type.id === state.selectedTypeId) || state.settings?.applicationTypes?.[0] || null; }

function renderApplicationList() {
  const types = state.settings?.applicationTypes || [];
  if ($("#applicationTypeCount")) $("#applicationTypeCount").textContent = types.length;
  if (!$("#applicationTypeList")) return;
  $("#applicationTypeList").innerHTML = types.length
    ? types.map(type => `<button type="button" class="resource-item ${type.id === state.selectedTypeId ? "selected" : ""}" data-type-id="${escapeHtml(type.id)}"><span class="resource-icon">${escapeHtml(type.emoji || "▤")}</span><span><strong>${escapeHtml(type.name)}</strong><small>${type.enabled !== false ? "Enabled" : "Disabled"} · ${(type.questions || []).length} questions</small></span></button>`).join("")
    : '<div class="empty-state">No applications yet.</div>';
}

function renderApplicationEditor() {
  const type = selectedType();
  renderApplicationList();
  if (!$("#applicationForm")) return;
  if (!type) return $("#applicationForm").classList.add("hidden");
  $("#applicationForm").classList.remove("hidden");
  const set = (id, value) => { if ($(`#${id}`)) $(`#${id}`).value = value ?? ""; };
  set("selectedApplicationName", type.name);
  set("selectedApplicationDescription", type.description);
  set("selectedApplicationCompletionMessage", type.completionMessage);
  set("selectedApplicationAcceptedMessage", type.acceptedMessage);
  set("selectedApplicationDeniedMessage", type.deniedMessage);
  if ($("#selectedApplicationReviewerRole")) { $("#selectedApplicationReviewerRole").innerHTML = roleOptions(type.reviewerRoleId, "Choose reviewer role"); $("#selectedApplicationReviewerRole").value = type.reviewerRoleId || ""; }
  if ($("#selectedApplicationAcceptedRole")) { $("#selectedApplicationAcceptedRole").innerHTML = roleOptions(type.approvalRoleId, "No accepted role"); $("#selectedApplicationAcceptedRole").value = type.approvalRoleId || ""; }
  if ($("#selectedApplicationReviewChannel")) { $("#selectedApplicationReviewChannel").innerHTML = channelOptions(type.reviewChannelId, "Use panel review channel"); $("#selectedApplicationReviewChannel").value = type.reviewChannelId || ""; }
  if ($("#selectedApplicationEnabled")) $("#selectedApplicationEnabled").checked = type.enabled !== false;
  if ($("#selectedApplicationQuestions")) $("#selectedApplicationQuestions").innerHTML = (type.questions || []).map((question, index) => `<div class="question-row" data-question-index="${index}"><label><span class="field-label">Question ${index + 1}</span><textarea data-q-field="label">${escapeHtml(question.label)}</textarea></label><label><span class="field-label">Max characters</span><input data-q-field="maxLength" type="number" value="${Number(question.maxLength || 1200)}" /></label><label class="check"><input data-q-field="required" type="checkbox" ${question.required !== false ? "checked" : ""} /> Required <button type="button" class="danger remove-question">Remove</button></label></div>`).join("") || '<div class="empty-state">No questions yet.</div>';
}

function saveEditorToState() {
  const type = selectedType();
  if (!type) return;
  const value = id => $(`#${id}`)?.value || "";
  type.name = value("selectedApplicationName").trim() || "Application";
  type.description = value("selectedApplicationDescription").trim();
  type.reviewerRoleId = value("selectedApplicationReviewerRole");
  type.approvalRoleId = value("selectedApplicationAcceptedRole");
  type.reviewChannelId = value("selectedApplicationReviewChannel");
  type.enabled = $("#selectedApplicationEnabled")?.checked !== false;
  type.completionMessage = value("selectedApplicationCompletionMessage");
  type.acceptedMessage = value("selectedApplicationAcceptedMessage");
  type.deniedMessage = value("selectedApplicationDeniedMessage");
  if ($("#selectedApplicationQuestions")) type.questions = $$(".question-row", $("#selectedApplicationQuestions")).map((row, index) => ({ id: type.questions?.[index]?.id || crypto.randomUUID(), label: row.querySelector('[data-q-field="label"]')?.value || "Question", maxLength: Number(row.querySelector('[data-q-field="maxLength"]')?.value || 1200), required: row.querySelector('[data-q-field="required"]')?.checked !== false }));
}

function fillPanelFields() {
  const settings = state.settings;
  if (!settings) return;
  const fields = { applicationPanelChannelId: channelOptions(settings.applicationPanelChannelId, "Choose panel channel"), applicationReviewChannelId: channelOptions(settings.applicationReviewChannelId, "Choose review channel"), applicationReviewedChannelId: channelOptions(settings.applicationReviewedChannelId, "No reviewed-results channel"), applicationReviewerRoleId: roleOptions(settings.applicationReviewerRoleId, "Choose reviewer role") };
  Object.entries(fields).forEach(([id, html]) => { if ($(`#${id}`)) { $(`#${id}`).innerHTML = html; $(`#${id}`).value = settings[id] || ""; } });
  ["applicationPanelTitle", "applicationPanelDescription", "applicationPanelColor", "applicationPanelImageUrl", "applicationPanelPlaceholder", "applicationPanelInteraction"].forEach(id => { if ($(`#${id}`)) $(`#${id}`).value = settings[id] || ""; });
  if ($("#applicationPanelDeleteOld")) $("#applicationPanelDeleteOld").checked = settings.applicationPanelDeleteOld !== false;
  if ($("#panelApplicationChecklist")) $("#panelApplicationChecklist").innerHTML = (settings.applicationTypes || []).map(type => `<label class="panel-check"><input type="checkbox" data-panel-type="${escapeHtml(type.id)}" ${type.enabled !== false ? "checked" : ""} /><span><strong>${escapeHtml(type.name)}</strong><small>${escapeHtml(type.description || "Application form")}</small></span></label>`).join("") || '<div class="empty-state">Create an application first.</div>';
}

function collectSettings() {
  saveEditorToState();
  const enabled = new Set($$('[data-panel-type]:checked').map(input => input.dataset.panelType));
  return { ...state.settings, applicationTypes: (state.settings.applicationTypes || []).map(type => ({ ...type, enabled: enabled.size ? enabled.has(type.id) : type.enabled !== false })), applicationPanelChannelId: $("#applicationPanelChannelId")?.value || "", applicationReviewChannelId: $("#applicationReviewChannelId")?.value || "", applicationReviewedChannelId: $("#applicationReviewedChannelId")?.value || "", applicationReviewerRoleId: $("#applicationReviewerRoleId")?.value || "", applicationPanelTitle: $("#applicationPanelTitle")?.value.trim() || "", applicationPanelDescription: $("#applicationPanelDescription")?.value.trim() || "", applicationPanelColor: $("#applicationPanelColor")?.value.trim() || "#2bd9fe", applicationPanelImageUrl: $("#applicationPanelImageUrl")?.value.trim() || "", applicationPanelPlaceholder: $("#applicationPanelPlaceholder")?.value.trim() || "Choose an application type", applicationPanelInteraction: $("#applicationPanelInteraction")?.value || "dropdown", applicationPanelDeleteOld: $("#applicationPanelDeleteOld")?.checked !== false };
}

function renderExtraPanels() {
  if (!$("#extraPanelsList")) return;
  $("#extraPanelsList").innerHTML = state.extraPanels.length ? state.extraPanels.map(panel => `<button type="button" class="resource-item ${panel.id === state.selectedExtraPanelId ? "selected" : ""}" data-extra-panel-id="${escapeHtml(panel.id)}"><span class="resource-icon">▣</span><span><strong>${escapeHtml(panel.name)}</strong><small>${panel.messageId ? "Published" : "Not published"}</small></span></button>`).join("") : '<div class="empty-state">No additional panels yet.</div>';
}

function renderExtraPanelForm() {
  const panel = state.extraPanels.find(item => item.id === state.selectedExtraPanelId);
  if (!$("#extraPanelForm")) return;
  if (!panel) return $("#extraPanelForm").classList.add("hidden");
  $("#extraPanelForm").classList.remove("hidden");
  const set = (id, value) => { if ($(`#${id}`)) $(`#${id}`).value = value ?? ""; };
  set("extraPanelName", panel.name); set("extraPanelTitle", panel.title); set("extraPanelDescription", panel.description); set("extraPanelColor", panel.color); set("extraPanelImageUrl", panel.imageUrl); set("extraPanelPlaceholder", panel.placeholder);
  if ($("#extraPanelChannelId")) { $("#extraPanelChannelId").innerHTML = channelOptions(panel.channelId, "Choose panel channel"); $("#extraPanelChannelId").value = panel.channelId || ""; }
  if ($("#extraPanelDeleteOld")) $("#extraPanelDeleteOld").checked = panel.deleteOld !== false;
  if ($("#extraPanelTypes")) $("#extraPanelTypes").innerHTML = (state.settings?.applicationTypes || []).map(type => `<label class="panel-check"><input type="checkbox" data-extra-type-id="${escapeHtml(type.id)}" ${panel.applicationTypeIds.includes(type.id) ? "checked" : ""} /><span><strong>${escapeHtml(type.name)}</strong><small>${escapeHtml(type.description || "Application form")}</small></span></label>`).join("") || '<div class="empty-state">Create an application first.</div>';
}

function readExtraPanelForm() {
  return { name: $("#extraPanelName")?.value.trim() || "New panel", channelId: $("#extraPanelChannelId")?.value || "", title: $("#extraPanelTitle")?.value.trim() || "Applications", description: $("#extraPanelDescription")?.value.trim() || "", color: $("#extraPanelColor")?.value.trim() || "#2bd9fe", imageUrl: $("#extraPanelImageUrl")?.value.trim() || "", placeholder: $("#extraPanelPlaceholder")?.value.trim() || "Choose an application type", deleteOld: $("#extraPanelDeleteOld")?.checked !== false, applicationTypeIds: $$('[data-extra-type-id]:checked').map(input => input.dataset.extraTypeId) };
}

function renderAccess() {
  const access = state.access;
  if (!access) return;
  const isOwner = state.userId === "1499890551997071431";
  if ($("#settingsRoleSummary")) $("#settingsRoleSummary").textContent = access.role === "owner" ? "Owner access" : "Administrator access";
  if (!isOwner) { $("#adminManagementCard")?.classList.add("hidden"); $("#permissionsManagementCard")?.classList.add("hidden"); return; }
  if ($("#settingsAdminsList")) $("#settingsAdminsList").innerHTML = access.members?.length ? access.members.map(member => `<div class="admin-row"><div><strong>${escapeHtml(member.username)}</strong><small>${escapeHtml(member.role)} · ${escapeHtml(member.userId)}</small></div><button class="danger remove-admin" type="button" data-admin-id="${escapeHtml(member.id)}">Remove</button></div>`).join("") : '<div class="empty-state">No manually added dashboard members.</div>';
  const permissions = access.permissions || {};
  $$('[data-permission-key]').forEach(input => { input.checked = permissions[input.dataset.permissionKey] === true; input.disabled = access.role !== "owner"; });
  if (access.role !== "owner") { $("#adminManagementCard")?.classList.add("hidden"); $("#permissionsManagementCard")?.classList.add("hidden"); }
  else { $("#adminManagementCard")?.classList.remove("hidden"); $("#permissionsManagementCard")?.classList.remove("hidden"); }
}

async function loadAccess() {
  state.access = await api("/api/access");
  renderAccess();
}

function loadServerAccess() {
  const stored = localStorage.getItem("dashboard_server_access");
  if (stored) {
    try {
      state.serverAccess = JSON.parse(stored);
    } catch { state.serverAccess = {}; }
  } else {
    state.serverAccess = {};
  }
  renderServerAccess();
}

function renderServerAccess() {
  const list = $("#serverAccessList");
  if (!list) return;
  const isOwner = state.userId === "1499890551997071431";
  const servers = state.servers.filter(s => isOwner || s.accessRole === "owner");
  list.innerHTML = servers.length ? servers.map(s => {
    const access = state.serverAccess[s.id] || { adminCanView: true, adminCanEdit: true };
    return `<div class="server-access-row">
    <div class="server-name">${escapeHtml(s.name)}</div>
    <div class="access-controls">
      <label><input type="checkbox" data-server-id="${escapeHtml(s.id)}" data-access="adminView" ${access.adminCanView ? "checked" : ""} ${!isOwner ? "disabled" : ""} /> Admin view</label>
      <label><input type="checkbox" data-server-id="${escapeHtml(s.id)}" data-access="adminEdit" ${access.adminCanEdit ? "checked" : ""} ${!isOwner ? "disabled" : ""} /> Admin edit</label>
    </div>
  </div>`;
  }).join("") : '<div class="empty-state">No servers found.</div>';
}

function saveServerAccess() {
  const items = $$("#serverAccessList input[type=checkbox]").map(input => ({
    serverId: input.dataset.serverId,
    access: input.dataset.access,
    enabled: input.checked
  }));
  for (const item of items) {
    const current = state.serverAccess[item.serverId] || { adminCanView: true, adminCanEdit: true };
    if (item.access === "adminView") current.adminCanView = item.enabled;
    if (item.access === "adminEdit") current.adminCanEdit = item.enabled;
    state.serverAccess[item.serverId] = current;
  }
  localStorage.setItem("dashboard_server_access", JSON.stringify(state.serverAccess));
  message($("#settingsMessage"), "Server access saved.", "success");
}

function resetServerAccess() {
  state.serverAccess = {};
  localStorage.removeItem("dashboard_server_access");
  loadServerAccess();
  message($("#settingsMessage"), "Server access reset to defaults.", "success");
}

async function loadSection(section) {
  if (section === "overview") {
    const [status, activity, applications] = await Promise.all([api("/api/status"), api("/api/activity"), api("/api/applications?status=pending")]);
    if ($("#botStatus")) $("#botStatus").textContent = status.online ? "Online" : "Offline";
    if ($("#botStatusDetail")) $("#botStatusDetail").textContent = `${status.guildName} · ${status.memberCount} members`;
    if ($("#memberCount")) $("#memberCount").textContent = status.memberCount;
    if ($("#applicationCount")) $("#applicationCount").textContent = applications.length;
    renderActivity(activity);
  }
  if (section === "pending") renderApplications(await api("/api/applications?status=pending"));
  if (["applications", "panels", "welcome"].includes(section)) {
    state.settings = await api("/api/settings");
    state.channels = await api("/api/channels");
    state.selectedTypeId ||= state.settings.applicationTypes?.[0]?.id || null;
    if (section === "applications") renderApplicationEditor();
    if (section === "panels") {
      fillPanelFields();
      const result = await api("/api/panels");
      state.extraPanels = result.panels || [];
      state.selectedExtraPanelId ||= state.extraPanels[0]?.id || null;
      renderExtraPanels();
      renderExtraPanelForm();
    }
    if (section === "welcome") {
      if ($("#welcomeChannelId")) { $("#welcomeChannelId").innerHTML = channelOptions(state.settings.welcomeChannelId, "Choose welcome channel"); $("#welcomeChannelId").value = state.settings.welcomeChannelId || ""; }
      if ($("#welcomeImageUrl")) $("#welcomeImageUrl").value = state.settings.welcomeImageUrl || "";
    }
  }
  if (section === "settings") { await loadAccess(); await loadServerAccess(); }
}

async function completeOAuthHandoff() {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("oauth") || new URLSearchParams(window.location.search).get("oauth");
  if (!token) return;
  const response = await fetch(`${API}/auth/handoff`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
  const body = await response.text();
  if (!response.ok) throw new Error(`OAuth handoff failed (${response.status}): ${body}`);
  const result = JSON.parse(body);
  if (!result.session) throw new Error("OAuth handoff returned no session.");
  state.session = result.session;
  state.guildId = "";
  localStorage.setItem("dashboard_session", result.session);
  localStorage.removeItem("dashboard_guild_id");
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

async function loadUser() {
  try {
    await completeOAuthHandoff();
    state.user = await api("/api/me");
    state.userId = state.user?.id || state.user?.userId || "";
    updateConnection(true, state.user);
    $("#authError")?.remove();
    await loadServers();
    await loadSection(state.section);
  } catch (error) {
    console.error("Dashboard authentication failed:", error);
    updateConnection(false);
    showAuthError(error);
  }
}

function bind(selector, eventName, handler) {
  const element = typeof selector === "string" ? $(selector) : selector;
  if (element) element.addEventListener(eventName, handler);
}

function bindAll(selector, eventName, handler) {
  $$(selector).forEach(element => element.addEventListener(eventName, handler));
}

bindAll("[data-section]", "click", event => showSection(event.currentTarget.dataset.section));
bindAll('[data-action="refresh"]', "click", () => location.reload());
bind("#serverPickerButton", "click", () => toggleServerMenu());

bind("#serverPickerMenu", "click", event => {
  const retryButton = event.target.closest("[data-retry-servers]");
  if (retryButton) { event.preventDefault(); state.serverError = null; loadServers(); return; }
  const hideButton = event.target.closest("[data-hide-server-id]");
  if (hideButton) {
    event.preventDefault();
    event.stopPropagation();
    const guildId = hideButton.dataset.hideServerId;
    state.hiddenGuildIds = [...new Set([...state.hiddenGuildIds, guildId])];
    if (state.guildId === guildId) {
      const replacement = state.servers.find(server => server.id !== guildId && !state.hiddenGuildIds.includes(server.id) && server.botInstalled);
      if (replacement) {
        state.guildId = replacement.id;
        localStorage.setItem("dashboard_guild_id", replacement.id);
        if ($("#sidebarServerName")) $("#sidebarServerName").textContent = replacement.name;
        if ($("#serverName")) $("#serverName").textContent = replacement.name;
      }
    }
    localStorage.setItem("dashboard_hidden_guilds", JSON.stringify(state.hiddenGuildIds));
    renderServerPicker();
    return;
  }
  const unhideButton = event.target.closest("[data-unhide-server-id]");
  if (unhideButton) {
    event.preventDefault();
    event.stopPropagation();
    state.hiddenGuildIds = state.hiddenGuildIds.filter(id => id !== unhideButton.dataset.unhideServerId);
    localStorage.setItem("dashboard_hidden_guilds", JSON.stringify(state.hiddenGuildIds));
    renderServerPicker();
    return;
  }
  const hiddenToggle = event.target.closest("[data-show-hidden]");
  if (hiddenToggle) { event.preventDefault(); event.stopPropagation(); state.showHiddenServers = !state.showHiddenServers; renderServerPicker(); return; }
  const reauth = event.target.closest("[data-reauth]");
  if (reauth) { event.preventDefault(); event.stopPropagation(); window.location.assign(`${API}/auth/discord`); return; }
  const invite = event.target.closest("[data-invite-url]");
  if (invite) { event.preventDefault(); window.open(invite.dataset.inviteUrl, "_blank", "noopener"); return; }
  const option = event.target.closest("[data-server-id]");
  if (option) switchServer(option.dataset.serverId).catch(showAuthError);
});

document.addEventListener("click", event => {
  if (!event.target.closest(".sidebar-server")) toggleServerMenu(false);
});

bind("#loginButton", "click", async () => {
  if (!state.user) return window.location.assign(`${API}/auth/discord`);
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  state.userId = "";
  state.session = "";
  state.guildId = "";
  localStorage.removeItem("dashboard_session");
  localStorage.removeItem("dashboard_guild_id");
  updateConnection(false);
});

bind("#addTypeTop", "click", () => {
  if (!state.settings) return;
  state.settings.applicationTypes ||= [];
  const type = { id: crypto.randomUUID(), name: "New application", description: "Start this application", emoji: "📋", enabled: true, reviewerRoleId: "", approvalRoleId: "", reviewChannelId: "", questions: [] };
  state.settings.applicationTypes.push(type);
  state.selectedTypeId = type.id;
  renderApplicationEditor();
});

bind("#applicationTypeList", "click", event => {
  const item = event.target.closest("[data-type-id]");
  if (!item) return;
  saveEditorToState();
  state.selectedTypeId = item.dataset.typeId;
  renderApplicationEditor();
});

bind("#addQuestionBottom", "click", () => {
  const type = selectedType();
  if (!type) return;
  saveEditorToState();
  type.questions ||= [];
  type.questions.push({ id: crypto.randomUUID(), label: "New question", required: true, maxLength: 1200 });
  renderApplicationEditor();
});

bind("#selectedApplicationQuestions", "click", event => {
  const button = event.target.closest(".remove-question");
  if (!button) return;
  const type = selectedType();
  if (!type) return;
  saveEditorToState();
  type.questions.splice(Number(button.closest(".question-row").dataset.questionIndex), 1);
  renderApplicationEditor();
});

bind("#saveApplications", "click", async () => {
  try {
    state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...collectSettings(), applicationTypes: state.settings.applicationTypes }) });
    renderApplicationEditor();
    message($("#applicationMessage"), "Application saved.", "success");
  } catch (error) { message($("#applicationMessage"), error.message, "error"); }
});

bind("#deleteApplication", "click", async () => {
  const type = selectedType();
  if (!type) return;
  if (!confirm(`Delete "${type.name}"? This cannot be undone.`)) return;
  try {
    state.settings.applicationTypes = state.settings.applicationTypes.filter(t => t.id !== type.id);
    state.selectedTypeId = state.settings.applicationTypes[0]?.id || null;
    state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...collectSettings(), applicationTypes: state.settings.applicationTypes }) });
    renderApplicationEditor();
    message($("#applicationMessage"), "Application deleted.", "success");
  } catch (error) { message($("#applicationMessage"), error.message, "error"); }
});

bind("#saveSettings", "click", async () => {
  try {
    state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(collectSettings()) });
    fillPanelFields();
    message($("#builderMessage"), "Panel saved.", "success");
  } catch (error) { message($("#builderMessage"), error.message, "error"); }
});

bind("#publishPanel", "click", async () => {
  try {
    state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(collectSettings()) });
    await api("/api/panel/publish", { method: "POST" });
    message($("#builderMessage"), "Panel sent to Discord.", "success");
  } catch (error) { message($("#builderMessage"), error.message, "error"); }
});

bind("#saveWelcome", "click", async () => {
  try {
    state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...state.settings, welcomeChannelId: $("#welcomeChannelId")?.value || "", welcomeImageUrl: $("#welcomeImageUrl")?.value.trim() || "" }) });
    message($("#welcomeMessage"), "Welcome settings saved.", "success");
  } catch (error) { message($("#welcomeMessage"), error.message, "error"); }
});

bind("#applicationsList", "click", async event => {
  const button = event.target.closest(".application-action");
  if (!button) return;
  try {
    await api(`/api/applications/${button.dataset.id}/${button.dataset.decision}`, { method: "POST" });
    await loadSection("pending");
  } catch (error) { alert(error.message); }
});

bind("#createExtraPanel", "click", async () => {
  try {
    const result = await api("/api/panels", { method: "POST", body: JSON.stringify({ name: "New panel", title: "Applications", color: "#2bd9fe", placeholder: "Choose an application type", deleteOld: true, applicationTypeIds: (state.settings?.applicationTypes || []).filter(type => type.enabled !== false).map(type => type.id) }) });
    state.extraPanels = result.panels || [];
    state.selectedExtraPanelId = result.panel.id;
    renderExtraPanels();
    renderExtraPanelForm();
  } catch (error) { message($("#extraPanelMessage"), error.message, "error"); }
});

bind("#extraPanelsList", "click", event => {
  const item = event.target.closest("[data-extra-panel-id]");
  if (!item) return;
  state.selectedExtraPanelId = item.dataset.extraPanelId;
  renderExtraPanels();
  renderExtraPanelForm();
});

bind("#saveExtraPanel", "click", async () => {
  if (!state.selectedExtraPanelId) return;
  try {
    const result = await api(`/api/panels/${state.selectedExtraPanelId}`, { method: "PUT", body: JSON.stringify(readExtraPanelForm()) });
    state.extraPanels = result.panels || [];
    renderExtraPanels();
    renderExtraPanelForm();
    message($("#extraPanelMessage"), "Panel saved.", "success");
  } catch (error) { message($("#extraPanelMessage"), error.message, "error"); }
});

bind("#publishExtraPanel", "click", async () => {
  if (!state.selectedExtraPanelId) return;
  try {
    await api(`/api/panels/${state.selectedExtraPanelId}`, { method: "PUT", body: JSON.stringify(readExtraPanelForm()) });
    const result = await api(`/api/panels/${state.selectedExtraPanelId}/publish`, { method: "POST" });
    state.extraPanels = result.panels || [];
    renderExtraPanels();
    renderExtraPanelForm();
    message($("#extraPanelMessage"), "Panel published to Discord.", "success");
  } catch (error) { message($("#extraPanelMessage"), error.message, "error"); }
});

bind("#deleteExtraPanel", "click", async () => {
  if (!state.selectedExtraPanelId || !confirm("Delete this additional panel?")) return;
  try {
    const result = await api(`/api/panels/${state.selectedExtraPanelId}`, { method: "DELETE" });
    state.extraPanels = result.panels || [];
    state.selectedExtraPanelId = state.extraPanels[0]?.id || null;
    renderExtraPanels();
    renderExtraPanelForm();
  } catch (error) { message($("#extraPanelMessage"), error.message, "error"); }
});

bind("#addSettingsAdmin", "click", async () => {
  try {
    const result = await api("/api/access/members", { method: "POST", body: JSON.stringify({ username: $("#settingsAdminUsername")?.value.trim() || "", role: $("#settingsAdminRole")?.value || "admin" }) });
    state.access.members = result.members;
    if ($("#settingsAdminUsername")) $("#settingsAdminUsername").value = "";
    renderAccess();
    message($("#settingsMessage"), "Dashboard member added.", "success");
  } catch (error) { message($("#settingsMessage"), error.message, "error"); }
});

bind("#settingsAdminsList", "click", async event => {
  const button = event.target.closest(".remove-admin");
  if (!button) return;
  try {
    const result = await api(`/api/access/members/${button.dataset.adminId}`, { method: "DELETE" });
    state.access.members = result.members;
    renderAccess();
    message($("#settingsMessage"), "Dashboard member removed.", "success");
  } catch (error) { message($("#settingsMessage"), error.message, "error"); }
});

bind("#saveAdminPermissions", "click", async () => {
  try {
    const permissions = Object.fromEntries($$("[data-permission-key]").map(input => [input.dataset.permissionKey, input.checked]));
    const result = await api("/api/access/permissions", { method: "PUT", body: JSON.stringify({ permissions }) });
    state.access.permissions = result.permissions;
    renderAccess();
    message($("#settingsMessage"), "Permissions saved.", "success");
  } catch (error) { message($("#settingsMessage"), error.message, "error"); }
});

bind("#saveServerAccess", "click", async () => {
  await saveServerAccess();
});

bind("#resetServerAccess", "click", async () => {
  if (!confirm("Reset all server access to defaults?")) return;
  await resetServerAccess();
});

loadUser();
