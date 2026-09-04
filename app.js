const API = window.DASHBOARD_CONFIG.apiBaseUrl.replace(/\/$/, "");
const state = { section: "overview", user: null, settings: null, channels: { channels: [], roles: [] }, selectedTypeId: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  if (response.status === 401) {
    state.user = null;
    updateConnection(false);
    throw new Error("Log in with Discord first.");
  }

  if (!response.ok) {
    throw new Error(await response.text() || `Request failed: ${response.status}`);
  }

  return response.status === 204 ? null : response.json();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[character]);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function message(element, text, type = "") {
  element.textContent = text;
  element.className = `form-message ${type}`;
}

function updateConnection(connected, user = null) {
  $("#connectionText").textContent = connected ? "Connected" : "Not connected";
  $(".connection-dot").style.background = connected ? "#58d893" : "#f0a84b";
  $("#loginButton").textContent = connected ? "Log out" : "Log in with Discord";

  if (user) {
    $("#serverName").textContent = user.guildName || "Connected server";
    $("#sidebarServerName").textContent = user.guildName || "Connected server";
  }
}

function showSection(section) {
  state.section = section;

  $$(".nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.section === section);
  });

  $$(".page-section").forEach(item => {
    item.classList.toggle("active-section", item.id === section);
  });

  const titles = {
    overview: "Overview",
    applications: "Applications",
    panels: "Panels",
    pending: "Pending applications",
    welcome: "Welcome"
  };

  $("#pageTitle").textContent = titles[section] || "Dashboard";

  if (state.user) {
    loadSection(section).catch(error => console.error(error));
  }
}

function renderActivity(items = []) {
  $("#activityCount").textContent = items.length;

  $("#activityFeed").innerHTML = items.length
    ? items.slice(0, 12).map(item => `
        <div class="activity-row">
          <div>
            <strong>${escapeHtml(item.action || item.type || "Activity")}</strong>
            <small>${escapeHtml(item.target || item.username || "Server event")}</small>
          </div>
          <small>${formatDate(item.at || item.createdAt)}</small>
        </div>
      `).join("")
    : '<div class="empty-state">No activity recorded yet.</div>';
}

function formatDuration(seconds) {
  const total = Number(seconds || 0);

  if (!Number.isFinite(total) || total <= 0) {
    return "—";
  }

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);

  return [
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    secs ? `${secs}s` : ""
  ].filter(Boolean).join(" ") || "0s";
}

function formatRelativeDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);

  const days = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 86400000)
  );

  if (!days) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function applicationStats(row) {
  const stats = row.submissionStats || row.stats || {};

  return {
    duration: formatDuration(
      row.durationSeconds ?? row.duration ?? stats.durationSeconds ?? stats.duration
    ),
    joined: formatRelativeDate(
      row.joinedAt ?? row.guildJoinedAt ?? stats.joinedAt ?? stats.guildJoinedAt
    ),
    submitted: formatDate(row.submittedAt ?? row.createdAt)
  };
}

function renderApplications(rows = []) {
  const pending = rows.filter(row => row.status === "pending");

  $("#applicationsList").innerHTML = pending.length
    ? pending.map(row => {
        const stats = applicationStats(row);
        const answers = Array.isArray(row.answers) ? row.answers : [];
        const applicant = row.username || row.user?.username || row.userId || "Unknown applicant";
        const displayUser = row.userMention || row.mention || `<@${escapeHtml(row.userId || "")}>`;

        return `<article class="application-card" data-application-id="${escapeHtml(row.id)}">
          <div class="application-card-head">
            <div>
              <p class="eyebrow">${escapeHtml(row.typeName || row.typeId || "Application")} application submitted</p>
              <h3>${escapeHtml(applicant)}'s “${escapeHtml(row.typeName || row.typeId || "Application")}” Application Submitted</h3>
              <p class="application-user">User: ${escapeHtml(displayUser)}</p>
            </div>
            <span class="status">Pending</span>
          </div>

          <div class="answer-list">
            ${answers.length
              ? answers.map((item, index) => `
                  <div class="answer-item">
                    <div class="answer-question">
                      ${index + 1}. ${escapeHtml(item.question || item.label || `Question ${index + 1}`)}
                    </div>
                    <div class="answer-value">
                      ${escapeHtml(item.answer || "(no answer)").split(String.fromCharCode(10)).join(String.fromCharCode(60, 98, 114, 62))}
                    </div>
                  </div>
                `).join("")
              : '<div class="empty-state">No answers were recorded.</div>'}
          </div>

          <div class="submission-stats">
            <p class="eyebrow">Submission stats</p>
            <div class="stats-grid">
              <div><span>User ID</span><strong>${escapeHtml(row.userId || "—")}</strong></div>
              <div><span>Username</span><strong>${escapeHtml(applicant)}</strong></div>
              <div><span>Duration</span><strong>${escapeHtml(stats.duration)}</strong></div>
              <div><span>Joined guild</span><strong>${escapeHtml(stats.joined)}</strong></div>
              <div><span>Submitted</span><strong>${escapeHtml(stats.submitted)}</strong></div>
            </div>
          </div>

          <div class="application-actions">
            <button class="primary application-action" data-id="${escapeHtml(row.id)}" data-decision="approved">
              Accept application
            </button>
            <button class="danger application-action" data-id="${escapeHtml(row.id)}" data-decision="denied">
              Deny application
            </button>
          </div>
        </article>`;
      }).join("")
    : '<div class="empty-state">There are no pending applications.</div>';
}

function options(items, selected, emptyLabel) {
  return `<option value="">${escapeHtml(emptyLabel)}</option>` +
    items.map(item => `
      <option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>
        ${escapeHtml(item.name)}
      </option>
    `).join("");
}

function channelOptions(selected, emptyLabel) {
  return options(state.channels.channels, selected, emptyLabel);
}

function roleOptions(selected, emptyLabel) {
  return options(state.channels.roles, selected, emptyLabel);
}

function selectedType() {
  return (state.settings?.applicationTypes || []).find(
    type => type.id === state.selectedTypeId
  ) || state.settings?.applicationTypes?.[0] || null;
}

function renderApplicationList() {
  const types = state.settings?.applicationTypes || [];
  $("#applicationTypeCount").textContent = types.length;

  $("#applicationTypeList").innerHTML = types.length
    ? types.map(type => `
        <button type="button" class="resource-item ${type.id === state.selectedTypeId ? "selected" : ""}" data-type-id="${escapeHtml(type.id)}">
          <span class="resource-icon">${escapeHtml(type.emoji || "▤")}</span>
          <span>
            <strong>${escapeHtml(type.name)}</strong>
            <small>${type.enabled !== false ? "Enabled" : "Disabled"} · ${(type.questions || []).length} questions</small>
          </span>
        </button>
      `).join("")
    : '<div class="empty-state">No applications yet.</div>';
}

function renderApplicationEditor() {
  const type = selectedType();
  renderApplicationList();

  if (!type) {
    $("#applicationForm").classList.add("hidden");
    return;
  }

  $("#applicationForm").classList.remove("hidden");
  $("#selectedApplicationName").value = type.name || "";
  $("#selectedApplicationDescription").value = type.description || "";

  $("#selectedApplicationReviewerRole").innerHTML = roleOptions(
    type.reviewerRoleId,
    "Choose reviewer role"
  );

  $("#selectedApplicationAcceptedRole").innerHTML = roleOptions(
    type.approvalRoleId,
    "No accepted role"
  );

  $("#selectedApplicationReviewChannel").innerHTML = channelOptions(
    type.reviewChannelId,
    "Use panel review channel"
  );

  $("#selectedApplicationReviewerRole").value = type.reviewerRoleId || "";
  $("#selectedApplicationAcceptedRole").value = type.approvalRoleId || "";
  $("#selectedApplicationReviewChannel").value = type.reviewChannelId || "";
  $("#selectedApplicationEnabled").checked = type.enabled !== false;
  $("#selectedApplicationCompletionMessage").value = type.completionMessage || "";
  $("#selectedApplicationAcceptedMessage").value = type.acceptedMessage || "";
  $("#selectedApplicationDeniedMessage").value = type.deniedMessage || "";

  $("#selectedApplicationQuestions").innerHTML = (type.questions || []).length
    ? type.questions.map((question, index) => `
        <div class="question-row" data-question-index="${index}">
          <label>
            <span class="field-label">Question ${index + 1}</span>
            <textarea data-q-field="label" maxlength="1000">${escapeHtml(question.label)}</textarea>
          </label>
          <label>
            <span class="field-label">Max characters</span>
            <input data-q-field="maxLength" type="number" min="20" max="2000" value="${Number(question.maxLength || 1200)}" />
          </label>
          <label class="check">
            <input data-q-field="required" type="checkbox" ${question.required !== false ? "checked" : ""} />
            Required
            <button type="button" class="danger remove-question">Remove</button>
          </label>
        </div>
      `).join("")
    : '<div class="empty-state">No questions yet. Add your first question.</div>';
}

function saveEditorToState() {
  const type = selectedType();
  if (!type) return;

  type.name = $("#selectedApplicationName").value.trim() || "Application";
  type.description = $("#selectedApplicationDescription").value.trim() || "Start this application";
  type.reviewerRoleId = $("#selectedApplicationReviewerRole").value;
  type.approvalRoleId = $("#selectedApplicationAcceptedRole").value;
  type.reviewChannelId = $("#selectedApplicationReviewChannel").value;
  type.enabled = $("#selectedApplicationEnabled").checked;
  type.completionMessage = $("#selectedApplicationCompletionMessage").value.trim();
  type.acceptedMessage = $("#selectedApplicationAcceptedMessage").value.trim();
  type.deniedMessage = $("#selectedApplicationDeniedMessage").value.trim();

  type.questions = $$(".question-row", $("#selectedApplicationQuestions")).map((row, index) => ({
    id: type.questions?.[index]?.id || crypto.randomUUID(),
    label: row.querySelector('[data-q-field="label"]').value.trim(),
    maxLength: Number(row.querySelector('[data-q-field="maxLength"]').value || 1200),
    required: row.querySelector('[data-q-field="required"]').checked
  }));
}

function renderPanelChecklist() {
  const types = state.settings?.applicationTypes || [];

  $("#panelApplicationChecklist").innerHTML = types.length
    ? types.map(type => `
        <label class="panel-check">
          <input type="checkbox" data-panel-type="${escapeHtml(type.id)}" ${type.enabled !== false ? "checked" : ""} />
          <span>
            <strong>${escapeHtml(type.name)}</strong>
            <small>${escapeHtml(type.description || "Application form")}</small>
          </span>
        </label>
      `).join("")
    : '<div class="empty-state">Create an application first.</div>';
}

function fillPanelFields() {
  const settings = state.settings;

  $("#applicationPanelChannelId").innerHTML = channelOptions(
    settings.applicationPanelChannelId,
    "Choose panel channel"
  );

  $("#applicationReviewChannelId").innerHTML = channelOptions(
    settings.applicationReviewChannelId,
    "Choose review channel"
  );

  $("#applicationReviewedChannelId").innerHTML = channelOptions(
    settings.applicationReviewedChannelId,
    "No reviewed-results channel"
  );

  $("#applicationReviewerRoleId").innerHTML = roleOptions(
    settings.applicationReviewerRoleId,
    "Choose reviewer role"
  );

  $("#applicationAcceptedRoleId").innerHTML = roleOptions(
    settings.applicationAcceptedRoleId,
    "No global accepted role"
  );

  [
    "applicationPanelChannelId",
    "applicationReviewChannelId",
    "applicationReviewedChannelId",
    "applicationReviewerRoleId",
    "applicationAcceptedRoleId"
  ].forEach(id => {
    $("#" + id).value = settings[id] || "";
  });

  $("#applicationPanelTitle").value = settings.applicationPanelTitle || "";
  $("#applicationPanelDescription").value = settings.applicationPanelDescription || "";
  $("#applicationPanelColor").value = settings.applicationPanelColor || "#2bd9fe";
  $("#applicationPanelImageUrl").value = settings.applicationPanelImageUrl || "";
  $("#applicationPanelPlaceholder").value = settings.applicationPanelPlaceholder || "Choose an application type";
  $("#applicationPanelInteraction").value = settings.applicationPanelInteraction || "dropdown";
  $("#applicationPanelDeleteOld").checked = settings.applicationPanelDeleteOld !== false;

  renderPanelChecklist();
}

function collectSettings() {
  saveEditorToState();

  const enabledFromPanel = new Set(
    $$('[data-panel-type]:checked').map(input => input.dataset.panelType)
  );

  const applicationTypes = (state.settings.applicationTypes || []).map(type => ({
    ...type,
    enabled: enabledFromPanel.size
      ? enabledFromPanel.has(type.id)
      : type.enabled !== false
  }));

  return {
    ...state.settings,
    applicationTypes,
    applicationPanelChannelId: $("#applicationPanelChannelId").value,
    applicationReviewChannelId: $("#applicationReviewChannelId").value,
    applicationReviewedChannelId: $("#applicationReviewedChannelId").value,
    applicationReviewerRoleId: $("#applicationReviewerRoleId").value,
    applicationAcceptedRoleId: $("#applicationAcceptedRoleId").value,
    applicationPanelTitle: $("#applicationPanelTitle").value.trim(),
    applicationPanelDescription: $("#applicationPanelDescription").value.trim(),
    applicationPanelColor: $("#applicationPanelColor").value.trim(),
    applicationPanelImageUrl: $("#applicationPanelImageUrl").value.trim(),
    applicationPanelInteraction: $("#applicationPanelInteraction").value,
    applicationPanelPlaceholder: $("#applicationPanelPlaceholder").value.trim(),
    applicationPanelDeleteOld: $("#applicationPanelDeleteOld").checked
  };
}

async function loadSection(section) {
  if (section === "overview") {
    const [status, activity, applications] = await Promise.all([
      api("/api/status"),
      api("/api/activity"),
      api("/api/applications?status=pending")
    ]);

    $("#botStatus").textContent = status.online ? "Online" : "Offline";
    $("#botStatusDetail").textContent = `${status.guildName} · ${status.memberCount} members`;
    $("#memberCount").textContent = status.memberCount;
    $("#applicationCount").textContent = applications.length;
    renderActivity(activity);
  }

  if (section === "pending") {
    renderApplications(await api("/api/applications?status=pending"));
  }

  if (section === "applications" || section === "panels" || section === "welcome") {
    state.settings = await api("/api/settings");
    state.channels = await api("/api/channels");
    state.selectedTypeId = state.selectedTypeId || state.settings.applicationTypes?.[0]?.id || null;

    if (section === "applications") {
      renderApplicationEditor();
    }

    if (section === "panels") {
      fillPanelFields();
    }

    if (section === "welcome") {
      $("#welcomeChannelId").innerHTML = channelOptions(
        state.settings.welcomeChannelId,
        "Choose welcome channel"
      );
      $("#welcomeChannelId").value = state.settings.welcomeChannelId || "";
      $("#welcomeImageUrl").value = state.settings.welcomeImageUrl || "";
    }
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

$$("[data-section]").forEach(button => {
  button.addEventListener("click", () => showSection(button.dataset.section));
});

$$('[data-action="refresh"]').forEach(button => {
  button.addEventListener("click", () => {
    loadSection(state.section).catch(error => alert(error.message));
  });
});

$("#loginButton").addEventListener("click", async () => {
  if (!state.user) {
    window.location.assign(`${API}/auth/discord`);
    return;
  }

  await api("/auth/logout", { method: "POST" });
  state.user = null;
  updateConnection(false);
});

$("#addTypeTop").addEventListener("click", () => {
  const type = {
    id: crypto.randomUUID(),
    name: "New application",
    description: "Start this application",
    emoji: "📋",
    enabled: true,
    reviewerRoleId: "",
    approvalRoleId: "",
    reviewChannelId: "",
    questions: []
  };

  state.settings.applicationTypes.push(type);
  state.selectedTypeId = type.id;
  renderApplicationEditor();
});

$("#applicationTypeList").addEventListener("click", event => {
  const item = event.target.closest("[data-type-id]");
  if (!item) return;

  saveEditorToState();
  state.selectedTypeId = item.dataset.typeId;
  renderApplicationEditor();
});

$("#addQuestionTop").addEventListener("click", () => {
  const type = selectedType();
  if (!type) return;

  saveEditorToState();
  type.questions.push({
    id: crypto.randomUUID(),
    label: "New question",
    required: true,
    maxLength: 1200
  });
  renderApplicationEditor();
});

$("#selectedApplicationQuestions").addEventListener("click", event => {
  const button = event.target.closest(".remove-question");
  if (!button) return;

  const type = selectedType();
  saveEditorToState();
  const row = button.closest(".question-row");
  type.questions.splice(Number(row.dataset.questionIndex), 1);
  renderApplicationEditor();
});

$("#saveApplications").addEventListener("click", async () => {
  try {
    state.settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        ...collectSettings(),
        applicationTypes: state.settings.applicationTypes
      })
    });

    renderApplicationEditor();
    message($("#applicationMessage"), "Application saved.", "success");
  } catch (error) {
    message($("#applicationMessage"), error.message, "error");
  }
});

$("#saveSettings").addEventListener("click", async () => {
  try {
    state.settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(collectSettings())
    });

    fillPanelFields();
    message($("#builderMessage"), "Panel saved.", "success");
  } catch (error) {
    message($("#builderMessage"), error.message, "error");
  }
});

$("#publishPanel").addEventListener("click", async () => {
  try {
    state.settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(collectSettings())
    });

    const result = await api("/api/panel/publish", { method: "POST" });
    state.settings = result.settings || state.settings;
    fillPanelFields();
    message($("#builderMessage"), "Panel sent to Discord.", "success");
  } catch (error) {
    message($("#builderMessage"), error.message, "error");
  }
});

$("#saveWelcome").addEventListener("click", async () => {
  try {
    state.settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        ...state.settings,
        welcomeChannelId: $("#welcomeChannelId").value,
        welcomeImageUrl: $("#welcomeImageUrl").value.trim()
      })
    });

    message($("#welcomeMessage"), "Welcome settings saved.", "success");
  } catch (error) {
    message($("#welcomeMessage"), error.message, "error");
  }
});

$("#applicationsList").addEventListener("click", async event => {
  const button = event.target.closest(".application-action");
  if (!button || !button.dataset.id) return;

  const action = button.dataset.decision === "approved" ? "accept" : "deny";
  if (!window.confirm(`Are you sure you want to ${action} this application?`)) return;

  button.disabled = true;

  try {
    await api(`/api/applications/${button.dataset.id}/${button.dataset.decision}`, {
      method: "POST"
    });
    await loadSection("pending");
  } catch (error) {
    button.disabled = false;
    alert(error.message);
  }
});

loadUser();
