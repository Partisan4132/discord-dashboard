const API = window.DASHBOARD_CONFIG.apiBaseUrl.replace(/\/$/, "");
const state = { section: "overview", user: null, settings: null, channels: { channels: [], roles: [] } };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (response.status === 401) { state.user = null; updateConnection(false); throw new Error("Log in to use the dashboard."); }
  if (!response.ok) throw new Error(await response.text() || `Request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character]); }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "—"; }
function message(element, text, type = "") { element.textContent = text; element.className = `form-message ${type}`; }
function updateConnection(connected, user = null) { $("#connectionText").textContent = connected ? "Connected" : "Not connected"; $(".connection-dot").style.background = connected ? "#58d893" : "#f0a84b"; $("#loginButton").textContent = connected ? "Log out" : "Log in with Discord"; if (user) $("#serverName").textContent = user.guildName || "Connected server"; }

function showSection(section) {
  state.section = section;
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.section === section));
  $$(".page-section").forEach(item => item.classList.toggle("active-section", item.id === section));
  $("#pageTitle").textContent = section[0].toUpperCase() + section.slice(1);
  if (state.user) loadSection(section).catch(error => console.error(error));
}

function renderActivity(items = []) {
  $("#activityCount").textContent = items.length;
  $("#activityFeed").innerHTML = items.length ? items.slice(0, 12).map(item => `<div class="activity-row"><div><strong>${escapeHtml(item.action || item.type || "Activity")}</strong><small>${escapeHtml(item.target || item.username || "Server event")}</small></div><small>${formatDate(item.at || item.createdAt)}</small></div>`).join("") : '<div class="empty-state">No activity recorded yet.</div>';
}

function renderTable(rows = []) {
  $("#applicationsTable").innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Applicant</th><th>Type</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.username || row.userId)}</td><td>${escapeHtml(row.typeName || row.typeId)}</td><td><span class="status ${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td><td>${formatDate(row.createdAt)}</td><td>${row.status === "pending" ? `<div class="review-actions"><button class="text-button" data-id="${escapeHtml(row.id)}" data-decision="approved">Approve</button><button class="text-button" data-id="${escapeHtml(row.id)}" data-decision="denied">Deny</button><button class="text-button" data-id="${escapeHtml(row.id)}" data-decision="changes_requested">Changes</button></div>` : "Reviewed"}</td></tr>`).join("")}</tbody></table>` : '<div class="empty-state">No applications found.</div>';
}

function options(items, selected, emptyLabel) { return `<option value="">${emptyLabel}</option>` + items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join(""); }
function channelOptions(selected, emptyLabel) { return options(state.channels.channels, selected, emptyLabel); }
function roleOptions(selected, emptyLabel) { return options(state.channels.roles, selected, emptyLabel); }

function renderTypes() {
  const types = state.settings.applicationTypes || [];
  $("#applicationTypes").innerHTML = types.length ? types.map((type, typeIndex) => `<div class="type-card" data-type-index="${typeIndex}"><div class="type-top"><label><span class="field-label">Name</span><input data-field="name" value="${escapeHtml(type.name)}" maxlength="100" /></label><label><span class="field-label">Description</span><input data-field="description" value="${escapeHtml(type.description)}" maxlength="100" /></label><div class="type-actions"><label class="enabled"><input data-field="enabled" type="checkbox" ${type.enabled !== false ? "checked" : ""} /> Enabled</label><button type="button" class="danger remove-type">Remove</button></div></div><div class="form-grid" style="margin-top:12px"><label>Reviewer role<select data-field="reviewerRoleId">${roleOptions(type.reviewerRoleId, "Global reviewer role")}</select></label><label>Accepted role<select data-field="approvalRoleId">${roleOptions(type.approvalRoleId, "Global accepted role")}</select></label><label>Review channel<select data-field="reviewChannelId">${channelOptions(type.reviewChannelId, "Global review channel")}</select></label><label>Emoji<input data-field="emoji" value="${escapeHtml(type.emoji || "")}" maxlength="32" /></label></div><div class="questions"><div class="card-heading"><strong>Questions</strong><button type="button" class="secondary add-question">Add question</button></div>${(type.questions || []).map((question, questionIndex) => `<div class="question-row" data-question-index="${questionIndex}"><label><span class="field-label">Question</span><textarea data-q-field="label" maxlength="1000">${escapeHtml(question.label)}</textarea></label><label><span class="field-label">Max characters</span><input data-q-field="maxLength" type="number" min="20" max="2000" value="${Number(question.maxLength || 1200)}" /></label><label class="check"><input data-q-field="required" type="checkbox" ${question.required !== false ? "checked" : ""} /> Required <button type="button" class="danger remove-question">Remove</button></label></div>`).join("")}</div></div>`).join("") : '<div class="empty-state">Add your first application type.</div>';
}

function fillSelects() {
  const s = state.settings;
  $("#applicationPanelChannelId").innerHTML = channelOptions(s.applicationPanelChannelId, "Choose panel channel");
  $("#applicationReviewChannelId").innerHTML = channelOptions(s.applicationReviewChannelId, "Choose review channel");
  $("#applicationReviewedChannelId").innerHTML = channelOptions(s.applicationReviewedChannelId, "No reviewed-results channel");
  $("#applicationReviewerRoleId").innerHTML = roleOptions(s.applicationReviewerRoleId, "Choose reviewer role");
  $("#applicationAcceptedRoleId").innerHTML = roleOptions(s.applicationAcceptedRoleId, "No global accepted role");
  $("#welcomeChannelId").innerHTML = channelOptions(s.welcomeChannelId, "Choose welcome channel");
  for (const id of ["applicationPanelChannelId", "applicationReviewChannelId", "applicationReviewedChannelId", "applicationReviewerRoleId", "applicationAcceptedRoleId", "welcomeChannelId"]) $("#" + id).value = s[id] || "";
  $("#applicationPanelTitle").value = s.applicationPanelTitle || "";
  $("#applicationPanelDescription").value = s.applicationPanelDescription || "";
  $("#applicationPanelColor").value = s.applicationPanelColor || "#2bd9fe";
  $("#applicationPanelImageUrl").value = s.applicationPanelImageUrl || "";
  $("#applicationPanelPlaceholder").value = s.applicationPanelPlaceholder || "Choose an application type";
  $("#applicationPanelDeleteOld").checked = s.applicationPanelDeleteOld !== false;
  $("#welcomeImageUrl").value = s.welcomeImageUrl || "";
  renderTypes();
}

function collectTypes() {
  return $$(".type-card").map(card => {
    const typeIndex = Number(card.dataset.typeIndex);
    const previous = state.settings.applicationTypes[typeIndex] || {};
    return { id: previous.id, name: card.querySelector('[data-field="name"]').value.trim(), description: card.querySelector('[data-field="description"]').value.trim(), enabled: card.querySelector('[data-field="enabled"]').checked, reviewerRoleId: card.querySelector('[data-field="reviewerRoleId"]').value, approvalRoleId: card.querySelector('[data-field="approvalRoleId"]').value, reviewChannelId: card.querySelector('[data-field="reviewChannelId"]').value, emoji: card.querySelector('[data-field="emoji"]').value.trim(), questions: $$(".question-row", card).map(row => ({ id: previous.questions?.[Number(row.dataset.questionIndex)]?.id || crypto.randomUUID(), label: row.querySelector('[data-q-field="label"]').value.trim(), maxLength: Number(row.querySelector('[data-q-field="maxLength"]').value || 1200), required: row.querySelector('[data-q-field="required"]').checked })) };
  });
}

function collectSettings() {
  return { ...state.settings, applicationPanelChannelId: $("#applicationPanelChannelId").value, applicationReviewChannelId: $("#applicationReviewChannelId").value, applicationReviewedChannelId: $("#applicationReviewedChannelId").value, applicationReviewerRoleId: $("#applicationReviewerRoleId").value, applicationAcceptedRoleId: $("#applicationAcceptedRoleId").value, applicationPanelTitle: $("#applicationPanelTitle").value.trim(), applicationPanelDescription: $("#applicationPanelDescription").value.trim(), applicationPanelColor: $("#applicationPanelColor").value.trim(), applicationPanelImageUrl: $("#applicationPanelImageUrl").value.trim(), applicationPanelPlaceholder: $("#applicationPanelPlaceholder").value.trim(), applicationPanelDeleteOld: $("#applicationPanelDeleteOld").checked, welcomeChannelId: $("#welcomeChannelId").value, welcomeImageUrl: $("#welcomeImageUrl").value.trim(), applicationTypes: collectTypes() };
}

async function loadSection(section) {
  if (section === "overview") { const [status, activity, applications] = await Promise.all([api("/api/status"), api("/api/activity"), api("/api/applications?status=pending")]); $("#botStatus").textContent = status.online ? "Online" : "Offline"; $("#botStatusDetail").textContent = `${status.guildName} · ${status.memberCount} members`; $("#memberCount").textContent = status.memberCount; $("#applicationCount").textContent = applications.length; renderActivity(activity); }
  if (section === "applications") renderTable(await api("/api/applications"));
  if (section === "builder" || section === "welcome") { state.settings = await api("/api/settings"); state.channels = await api("/api/channels"); fillSelects(); }
}

async function loadUser() { try { state.user = await api("/api/me"); updateConnection(true, state.user); await loadSection(state.section); } catch { updateConnection(false); } }

$$("[data-section]").forEach(button => button.addEventListener("click", () => showSection(button.dataset.section)));
$$('[data-action="refresh"]').forEach(button => button.addEventListener("click", () => loadSection(state.section).catch(error => alert(error.message))));
$("#loginButton").addEventListener("click", async () => { if (!state.user) { window.location.href = `${API}/auth/discord`; return; } await api("/auth/logout", { method: "POST" }); state.user = null; updateConnection(false); });
$("#addType").addEventListener("click", () => { state.settings.applicationTypes.push({ id: crypto.randomUUID(), name: "New application", description: "Start this application", emoji: "📋", enabled: true, reviewerRoleId: "", approvalRoleId: "", reviewChannelId: "", questions: [] }); renderTypes(); });
$("#applicationTypes").addEventListener("click", event => { const card = event.target.closest(".type-card"); if (!card) return; const typeIndex = Number(card.dataset.typeIndex); if (event.target.closest(".remove-type")) { state.settings.applicationTypes.splice(typeIndex, 1); renderTypes(); } if (event.target.closest(".add-question")) { state.settings.applicationTypes[typeIndex].questions.push({ id: crypto.randomUUID(), label: "New question", required: true, maxLength: 1200 }); renderTypes(); } if (event.target.closest(".remove-question")) { const row = event.target.closest(".question-row"); state.settings.applicationTypes[typeIndex].questions.splice(Number(row.dataset.questionIndex), 1); renderTypes(); } });
$("#saveSettings").addEventListener("click", async () => { try { state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(collectSettings()) }); fillSelects(); message($("#builderMessage"), "Settings saved.", "success"); } catch (error) { message($("#builderMessage"), error.message, "error"); } });
$("#publishPanel").addEventListener("click", async () => { try { state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(collectSettings()) }); const result = await api("/api/panel/publish", { method: "POST" }); state.settings = result.settings; fillSelects(); message($("#builderMessage"), "Panel published to Discord.", "success"); } catch (error) { message($("#builderMessage"), error.message, "error"); } });
$("#saveWelcome").addEventListener("click", async () => { try { state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...state.settings, welcomeChannelId: $("#welcomeChannelId").value, welcomeImageUrl: $("#welcomeImageUrl").value.trim() }) }); message($("#welcomeMessage"), "Welcome settings saved.", "success"); } catch (error) { message($("#welcomeMessage"), error.message, "error"); } });
$("#applicationsTable").addEventListener("click", async event => { const button = event.target.closest(".application-action,.text-button"); if (!button || !button.dataset.id) return; try { await api(`/api/applications/${button.dataset.id}/${button.dataset.decision}`, { method: "POST" }); await loadSection("applications"); } catch (error) { alert(error.message); } });
loadUser();
