const API = window.DASHBOARD_CONFIG.apiBaseUrl.replace(/\/$/, "");

const state = {
  section: "overview",
  user: null,
  settings: null,
  channels: { channels: [], roles: [] },
  selectedTypeId: null,
  session: localStorage.getItem("dashboard_session") || ""
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(path, options = {}) {
  const { headers = {}, ...requestOptions } = options;

  const response = await fetch(`${API}${path}`, {
    ...requestOptions,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(state.session
        ? { Authorization: `Bearer ${state.session}` }
        : {}),
      ...headers
    }
  });

  if (response.status === 401) {
    state.user = null;
    state.session = "";
    localStorage.removeItem("dashboard_session");
    updateConnection(false);
    throw new Error("Log in with Discord first.");
  }

  if (!response.ok) {
    throw new Error(
      (await response.text()) || `Request failed: ${response.status}`
    );
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
  if (!element) {
    console.warn("Dashboard message element not found:", text);
    return;
  }

  element.textContent = text;
  element.className = `form-message ${type}`;
}

function showAuthError(error) {
  let element = $("#authError");

  if (!element) {
    element = document.createElement("div");
    element.id = "authError";
    element.className = "form-message error";
    element.style.marginTop = "12px";
    element.style.maxWidth = "560px";

    const loginButton = $("#loginButton");
    if (loginButton?.parentElement) {
      loginButton.parentElement.appendChild(element);
    } else {
      document.body.prepend(element);
    }
  }

  message(element, error?.message || "Dashboard authentication failed.", "error");
}

function updateConnection(connected, user = null) {
  const connectionText = $("#connectionText");
  const connectionDot = $(".connection-dot");
  const loginButton = $("#loginButton");

  if (connectionText) {
    connectionText.textContent = connected
      ? "Connected"
      : "Not connected";
  }

  if (connectionDot) {
    connectionDot.style.background = connected
      ? "#58d893"
      : "#f0a84b";
  }

  if (loginButton) {
    loginButton.textContent = connected
      ? "Log out"
      : "Log in with Discord";
  }

  if (user) {
    const serverName = $("#serverName");
    const sidebarServerName = $("#sidebarServerName");

    if (serverName) {
      serverName.textContent = user.guildName || "Connected server";
    }

    if (sidebarServerName) {
      sidebarServerName.textContent = user.guildName || "Connected server";
    }
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

  const pageTitle = $("#pageTitle");
  if (pageTitle) {
    pageTitle.textContent = titles[section] || "Dashboard";
  }

  if (state.user) {
    loadSection(section).catch(error => {
      console.error("Section load failed:", error);
    });
  }
}

function renderActivity(items = []) {
  const activityCount = $("#activityCount");
  const activityFeed = $("#activityFeed");

  if (activityCount) {
    activityCount.textContent = items.length;
  }

  if (!activityFeed) return;

  activityFeed.innerHTML = items.length
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
  if (!Number.isFinite(total) || total <= 0) return "—";

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
  const applicationsList = $("#applicationsList");
  if (!applicationsList) return;

  const pending = rows.filter(row => row.status === "pending");

  applicationsList.innerHTML = pending.length
    ? pending.map(row => {
        const stats = applicationStats(row);
        const answers = Array.isArray(row.answers) ? row.answers : [];
        const applicant = row.username || row.user?.username || row.userId || "Unknown applicant";
        const displayUser = row.userMention || row.mention || `<@${row.userId || ""}>`;

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
  return options(state.channels.channels || [], selected, emptyLabel);
}

function roleOptions(selected, emptyLabel) {
  return options(state.channels.roles || [], selected, emptyLabel);
}

function selectedType() {
  return (state.settings?.applicationTypes || []).find(
    type => type.id === state.selectedTypeId
  ) || state.settings?.applicationTypes?.[0] || null;
}

function renderApplicationList() {
  const applicationTypeCount = $("#applicationTypeCount");
  const applicationTypeList = $("#applicationTypeList");
  const types = state.settings?.applicationTypes || [];

  if (applicationTypeCount) {
    applicationTypeCount.textContent = types.length;
  }

  if (!applicationTypeList) return;

  applicationTypeList.innerHTML = types.length
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

  const applicationForm = $("#applicationForm");
  if (!applicationForm) return;

  if (!type) {
    applicationForm.classList.add("hidden");
    return;
  }

  applicationForm.classList.remove("hidden");

  const name = $("#selectedApplicationName");
  const description = $("#selectedApplicationDescription");
  const reviewerRole = $("#selectedApplicationReviewerRole");
  const acceptedRole = $("#selectedApplicationAcceptedRole");
  const reviewChannel = $("#selectedApplicationReviewChannel");
  const enabled = $("#selectedApplicationEnabled");
  const completionMessage = $("#selectedApplicationCompletionMessage");
  const acceptedMessage = $("#selectedApplicationAcceptedMessage");
  const deniedMessage = $("#selectedApplicationDeniedMessage");
  const questions = $("#selectedApplicationQuestions");

  if (name) name.value = type.name || "";
  if (description) description.value = type.description || "";

  if (reviewerRole) {
    reviewerRole.innerHTML = roleOptions(
      type.reviewerRoleId,
      "Choose reviewer role"
    );
    reviewerRole.value = type.reviewerRoleId || "";
  }

  if (acceptedRole) {
    acceptedRole.innerHTML = roleOptions(
      type.approvalRoleId,
      "No accepted role"
    );
    acceptedRole.value = type.approvalRoleId || "";
  }

  if (reviewChannel) {
    reviewChannel.innerHTML = channelOptions(
      type.reviewChannelId,
      "Use panel review channel"
    );
    reviewChannel.value = type.reviewChannelId || "";
  }

  if (enabled) enabled.checked = type.enabled !== false;
  if (completionMessage) completionMessage.value = type.completionMessage || "";
  if (acceptedMessage) acceptedMessage.value = type.acceptedMessage || "";
  if (deniedMessage) deniedMessage.value = type.deniedMessage || "";

  if (!questions) return;

  questions.innerHTML = (type.questions || []).length
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

  const name = $("#selectedApplicationName");
  const description = $("#selectedApplicationDescription");
  const reviewerRole = $("#selectedApplicationReviewerRole");
  const acceptedRole = $("#selectedApplicationAcceptedRole");
  const reviewChannel = $("#selectedApplicationReviewChannel");
  const enabled = $("#selectedApplicationEnabled");
  const completionMessage = $("#selectedApplicationCompletionMessage");
  const acceptedMessage = $("#selectedApplicationAcceptedMessage");
  const deniedMessage = $("#selectedApplicationDeniedMessage");
  const questionsContainer = $("#selectedApplicationQuestions");

  if (name) type.name = name.value.trim() || "Application";
  if (description) type.description = description.value.trim() || "Start this application";
  if (reviewerRole) type.reviewerRoleId = reviewerRole.value;
  if (acceptedRole) type.approvalRoleId = acceptedRole.value;
  if (reviewChannel) type.reviewChannelId = reviewChannel.value;
  if (enabled) type.enabled = enabled.checked;
  if (completionMessage) type.completionMessage = completionMessage.value.trim();
  if (acceptedMessage) type.acceptedMessage = acceptedMessage.value.trim();
  if (deniedMessage) type.deniedMessage = deniedMessage.value.trim();

  if (!questionsContainer) return;

  type.questions = $$(".question-row", questionsContainer).map((row, index) => ({
    id: type.questions?.[index]?.id || crypto.randomUUID(),
    label: row.querySelector('[data-q-field="label"]')?.value.trim() || "Question",
    maxLength: Number(row.querySelector('[data-q-field="maxLength"]')?.value || 1200),
    required: row.querySelector('[data-q-field="required"]')?.checked !== false
  }));
}

function renderPanelChecklist() {
  const panelApplicationChecklist = $("#panelApplicationChecklist");
  const types = state.settings?.applicationTypes || [];

  if (!panelApplicationChecklist) return;

  panelApplicationChecklist.innerHTML = types.length
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
  if (!settings) return;

  const panelChannel = $("#applicationPanelChannelId");
  const reviewChannel = $("#applicationReviewChannelId");
  const reviewedChannel = $("#applicationReviewedChannelId");
  const reviewerRole = $("#applicationReviewerRoleId");
  const acceptedRole = $("#applicationAcceptedRoleId");

  if (panelChannel) {
    panelChannel.innerHTML = channelOptions(
      settings.applicationPanelChannelId,
      "Choose panel channel"
    );
    panelChannel.value = settings.applicationPanelChannelId || "";
  }

  if (reviewChannel) {
    reviewChannel.innerHTML = channelOptions(
      settings.applicationReviewChannelId,
      "Choose review channel"
    );
    reviewChannel.value = settings.applicationReviewChannelId || "";
  }

  if (reviewedChannel) {
    reviewedChannel.innerHTML = channelOptions(
      settings.applicationReviewedChannelId,
      "No reviewed-results channel"
    );
    reviewedChannel.value = settings.applicationReviewedChannelId || "";
  }

  if (reviewerRole) {
    reviewerRole.innerHTML = roleOptions(
      settings.applicationReviewerRoleId,
      "Choose reviewer role"
    );
    reviewerRole.value = settings.applicationReviewerRoleId || "";
  }

  if (acceptedRole) {
    acceptedRole.innerHTML = roleOptions(
      settings.applicationAcceptedRoleId,
      "No global accepted role"
    );
    acceptedRole.value = settings.applicationAcceptedRoleId || "";
  }

  const panelTitle = $("#applicationPanelTitle");
  const panelDescription = $("#applicationPanelDescription");
  const panelColor = $("#applicationPanelColor");
  const panelImageUrl = $("#applicationPanelImageUrl");
  const panelPlaceholder = $("#applicationPanelPlaceholder");
  const panelInteraction = $("#applicationPanelInteraction");
  const deleteOld = $("#applicationPanelDeleteOld");

  if (panelTitle) panelTitle.value = settings.applicationPanelTitle || "";
  if (panelDescription) panelDescription.value = settings.applicationPanelDescription || "";
  if (panelColor) panelColor.value = settings.applicationPanelColor || "#2bd9fe";
  if (panelImageUrl) panelImageUrl.value = settings.applicationPanelImageUrl || "";
  if (panelPlaceholder) panelPlaceholder.value = settings.applicationPanelPlaceholder || "Choose an application type";
  if (panelInteraction) panelInteraction.value = settings.applicationPanelInteraction || "dropdown";
  if (deleteOld) deleteOld.checked = settings.applicationPanelDeleteOld !== false;

  renderPanelChecklist();
}

async function completeOAuthHandoff() {
  const hashParams = new URLSearchParams(
    window.location.hash.replace(/^#/, "")
  );
  const queryParams = new URLSearchParams(window.location.search);
  const token = hashParams.get("oauth") || queryParams.get("oauth");

  if (!token) return;

  const response = await fetch(`${API}/auth/handoff`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token })
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`OAuth handoff failed (${response.status}): ${body}`);
  }

  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error("OAuth handoff returned invalid JSON.");
  }

  if (!result.session) {
    throw new Error("OAuth handoff returned no session.");
  }

  state.session = result.session;
  localStorage.setItem("dashboard_session", result.session);

  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search
  );
}

function collectSettings() {
  saveEditorToState();

  const enabledFromPanel = new Set(
    $$('[data-panel-type]:checked').map(input => input.dataset.panelType)
  );

  const applicationTypes = (state.settings?.applicationTypes || []).map(type => ({
    ...type,
    enabled: enabledFromPanel.size
      ? enabledFromPanel.has(type.id)
      : type.enabled !== false
  }));

  return {
    ...state.settings,
    applicationTypes,
    applicationPanelChannelId: $("#applicationPanelChannelId")?.value || "",
    applicationReviewChannelId: $("#applicationReviewChannelId")?.value || "",
    applicationReviewedChannelId: $("#applicationReviewedChannelId")?.value || "",
    applicationReviewerRoleId: $("#applicationReviewerRoleId")?.value || "",
    applicationAcceptedRoleId: $("#applicationAcceptedRoleId")?.value || "",
    applicationPanelTitle: $("#applicationPanelTitle")?.value.trim() || "",
    applicationPanelDescription: $("#applicationPanelDescription")?.value.trim() || "",
    applicationPanelColor: $("#applicationPanelColor")?.value.trim() || "#2bd9fe",
    applicationPanelImageUrl: $("#applicationPanelImageUrl")?.value.trim() || "",
    applicationPanelInteraction: $("#applicationPanelInteraction")?.value || "dropdown",
    applicationPanelPlaceholder: $("#applicationPanelPlaceholder")?.value.trim() || "Choose an application type",
    applicationPanelDeleteOld: $("#applicationPanelDeleteOld")?.checked !== false
  };
}

async function loadSection(section) {
  if (section === "overview") {
    const [status, activity, applications] = await Promise.all([
      api("/api/status"),
      api("/api/activity"),
      api("/api/applications?status=pending")
    ]);

    const botStatus = $("#botStatus");
    const botStatusDetail = $("#botStatusDetail");
    const memberCount = $("#memberCount");
    const applicationCount = $("#applicationCount");

    if (botStatus) botStatus.textContent = status.online ? "Online" : "Offline";
    if (botStatusDetail) botStatusDetail.textContent = `${status.guildName} · ${status.memberCount} members`;
    if (memberCount) memberCount.textContent = status.memberCount;
    if (applicationCount) applicationCount.textContent = applications.length;

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
      const welcomeChannel = $("#welcomeChannelId");
      const welcomeImage = $("#welcomeImageUrl");

      if (welcomeChannel) {
        welcomeChannel.innerHTML = channelOptions(
          state.settings.welcomeChannelId,
          "Choose welcome channel"
        );
        welcomeChannel.value = state.settings.welcomeChannelId || "";
      }

      if (welcomeImage) {
        welcomeImage.value = state.settings.welcomeImageUrl || "";
      }
    }
  }
}

async function loadUser() {
  try {
    await completeOAuthHandoff();
    state.user = await api("/api/me");
    updateConnection(true, state.user);

    const authError = $("#authError");
    if (authError) authError.remove();

    await loadSection(state.section);
  } catch (error) {
    console.error("Dashboard authentication failed:", error);
    updateConnection(false);
    showAuthError(error);
  }
}

function bind(selector, eventName, handler) {
  const element = typeof selector === "string"
    ? document.querySelector(selector)
    : selector;

  if (!element) {
    console.warn(`Dashboard element not found: ${selector}`);
    return;
  }

  element.addEventListener(eventName, handler);
}

function bindAll(selector, eventName, handler) {
  document.querySelectorAll(selector).forEach(element => {
    element.addEventListener(eventName, handler);
  });
}

bindAll("[data-section]", "click", event => {
  showSection(event.currentTarget.dataset.section);
});

bindAll('[data-action="refresh"]', "click", () => {
  loadSection(state.section).catch(error => alert(error.message));
});

bind("#loginButton", "click", async () => {
  if (!state.user) {
    window.location.assign(`${API}/auth/discord`);
    return;
  }

  await api("/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  state.session = "";
  localStorage.removeItem("dashboard_session");
  updateConnection(false);
});

bind("#addTypeTop", "click", () => {
  if (!state.settings) return;

  state.settings.applicationTypes = state.settings.applicationTypes || [];

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

bind("#applicationTypeList", "click", event => {
  const item = event.target.closest("[data-type-id]");
  if (!item) return;

  saveEditorToState();
  state.selectedTypeId = item.dataset.typeId;
  renderApplicationEditor();
});

bind("#addQuestionTop", "click", () => {
  const type = selectedType();
  if (!type) return;

  saveEditorToState();
  type.questions = type.questions || [];
  type.questions.push({
    id: crypto.randomUUID(),
    label: "New question",
    required: true,
    maxLength: 1200
  });
  renderApplicationEditor();
});

bind("#selectedApplicationQuestions", "click", event => {
  const button = event.target.closest(".remove-question");
  if (!button) return;

  const type = selectedType();
  if (!type) return;

  saveEditorToState();
  const row = button.closest(".question-row");
  if (!row) return;

  type.questions.splice(Number(row.dataset.questionIndex), 1);
  renderApplicationEditor();
});

bind("#saveApplications", "click", async () => {
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

bind("#saveSettings", "click", async () => {
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

bind("#publishPanel", "click", async () => {
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

bind("#saveWelcome", "click", async () => {
  try {
    state.settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        ...state.settings,
        welcomeChannelId: $("#welcomeChannelId")?.value || "",
        welcomeImageUrl: $("#welcomeImageUrl")?.value.trim() || ""
      })
    });

    message($("#welcomeMessage"), "Welcome settings saved.", "success");
  } catch (error) {
    message($("#welcomeMessage"), error.message, "error");
  }
});

bind("#applicationsList", "click", async event => {
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
