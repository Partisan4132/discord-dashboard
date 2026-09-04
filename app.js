const API = window.DASHBOARD_CONFIG.apiBaseUrl.replace(/\/$/, "" );
const state = { section: "overview", user: null, settings: null, channels: { channels: [], roles: [] }, selectedTypeId: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (response.status === 401) { state.user = null; updateConnection(false); throw new Error("Log in with Discord first."); }
  if (!response.ok) throw new Error(await response.text() || `Request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character]); }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "—"; }
function message(element, text, type = "") { element.textContent = text; element.className = `form-message ${type}`; }
function updateConnection(connected, user = null) { $("#connectionText").textContent = connected ? "Connected" : "Not connected"; $(".connection-dot").style.background = connected ? "#58d893" : "#f0a84b"; $("#loginButton").textContent = connected ? "Log out" : "Log in with Discord"; if (user) { $("#serverName").textContent = user.guildName || "Connected server"; $("#sidebarServerName").textContent = user.guildName || "Connected server"; } }

function showSection(section) {
  state.section = section;
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.section === section));
  $$(".page-section").forEach(item => item.classList.toggle("active-section", item.id === section));
  const titles = { overview: "Overview", applications: "Applications", panels: "Panels", pending: "Pending applications", welcome: "Welcome" };
  $("#pageTitle").textContent = titles[section] || "Dashboard";
  if (state.user) loadSection(section).catch(error => console.error(error));
}

function renderActivity(items = []) {
  $("#activityCount").textContent = items.length;
  $("#activityFeed").innerHTML = items.length ? items.slice(0, 12).map(item => `<div class="activity-row"><div><strong>${escapeHtml(item.action || item.type || "Activity")}</strong><small>${escapeHt
$$
