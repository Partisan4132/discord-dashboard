import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { PermissionFlagsBits } from "discord.js";
import { config } from "./config.js";
import {
  getApplication,
  guildSettings,
  listApplications,
  listModeration,
  saveGuildSettings
} from "./store.js";
import {
  effectiveSettings,
  isReviewer,
  normalizeApplicationTypes,
  reviewApplication
} from "./applications.js";
import { buildApplicationPanel } from "./panel.js";

const app = express();
const port = Number(process.env.API_PORT || 3001);
const sessionSecret = process.env.DASHBOARD_SESSION_SECRET || "";
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET || "";
const discordRedirectUri = process.env.DISCORD_REDIRECT_URI || "";

const origins = (process.env.DASHBOARD_ORIGIN || "")
  .split(",")
  .map(value => value.trim().replace(/\/$/, ""))
  .filter(Boolean);

const oauthHandoffs = new Map();
const oauthHandoffGracePeriodMs = 5 * 60 * 1000;

app.use(express.json({ limit: "300kb" }));

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"));
    },
    credentials: true
  })
);

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function createSession(payload) {
  if (!sessionSecret) {
    throw new Error("DASHBOARD_SESSION_SECRET is not configured.");
  }

  const body = base64url(
    JSON.stringify({
      ...payload,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    })
  );

  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

function readSession(value) {
  if (!value || !sessionSecret) return null;

  const [body, signature] = String(value).split(".");
  if (!body || !signature) return null;

  const expected = crypto
    .createHmac("sha256", sessionSecret)
    .update(body)
    .digest("base64url");

  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function cookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map(value => value.trim().split("="))
      .filter(parts => parts.length >= 2)
      .map(([key, ...rest]) => [key, decodeURIComponent(rest.join("="))])
  );
}

function setCookie(response, name, value, maxAge = 60 * 60 * 24 * 7) {
  response.setHeader(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=None`
  );
}

function clearCookie(response, name) {
  response.setHeader(
    "Set-Cookie",
    `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None`
  );
}

function createOAuthHandoff(session) {
  const token = crypto.randomBytes(32).toString("hex");

  oauthHandoffs.set(token, {
    session,
    expiresAt: Date.now() + oauthHandoffGracePeriodMs
  });

  return token;
}

function takeOAuthHandoff(token) {
  const key = String(token || "");
  const item = oauthHandoffs.get(key);

  if (!item) return null;

  if (item.expiresAt <= Date.now()) {
    oauthHandoffs.delete(key);
    return null;
  }

  // Do not delete immediately. A browser, extension, or page reload can
  // submit the same callback fragment more than once. Returning the same
  // short-lived session makes the handoff safely idempotent.
  return item.session;
}

function dashboardOrigin() {
  return origins[0] || "http://localhost:8080";
}

function requireSession(request, response, next ) {
  const authorization = String(request.headers.authorization || "");
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  const session = readSession(
    bearer || cookies(request).dashboard_session
  );

  if (!session || session.guildId !== config.guildId) {
    return response.status(401).json({ error: "Login required." });
  }

  request.dashboardSession = session;
  next();
}

function guildFor(client) {
  return client.guilds.cache.get(config.guildId) || null;
}

function validUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol ) ? url.toString() : "";
  } catch {
    return "";
  }
}

function cleanSettings(body) {
  const input = body && typeof body === "object" ? body : {};

  return {
    welcomeChannelId: String(input.welcomeChannelId || "").trim(),
    welcomeImageUrl: validUrl(input.welcomeImageUrl),
    applicationPanelChannelId: String(input.applicationPanelChannelId || "").trim(),
    applicationPanelMessageId: String(input.applicationPanelMessageId || "").trim(),
    applicationPanelTitle: String(input.applicationPanelTitle || "Applications")
      .trim()
      .slice(0, 256),
    applicationPanelDescription: String(input.applicationPanelDescription || "")
      .trim()
      .slice(0, 4096),
    applicationPanelColor: /^#?[0-9a-fA-F]{6}$/.test(
      String(input.applicationPanelColor || "")
    )
      ? String(input.applicationPanelColor).startsWith("#")
        ? String(input.applicationPanelColor)
        : `#${input.applicationPanelColor}`
      : "#2bd9fe",
    applicationPanelImageUrl: validUrl(input.applicationPanelImageUrl),
    applicationPanelPlaceholder: String(
      input.applicationPanelPlaceholder || "Choose an application type"
    )
      .trim()
      .slice(0, 150),
    applicationPanelDeleteOld: input.applicationPanelDeleteOld !== false,
    applicationReviewChannelId: String(input.applicationReviewChannelId || "").trim(),
    applicationReviewedChannelId: String(input.applicationReviewedChannelId || "").trim(),
    applicationReviewerRoleId: String(input.applicationReviewerRoleId || "").trim(),
    applicationAcceptedRoleId: String(input.applicationAcceptedRoleId || "").trim(),
    applicationTypes: normalizeApplicationTypes(input.applicationTypes)
  };
}

function activity(client) {
  const moderation = listModeration(config.guildId).map(item => ({
    ...item,
    type: "moderation",
    at: item.at
  }));

  const applications = listApplications(config.guildId).map(item => ({
    action: `application_${item.status}`,
    type: "application",
    target: item.username || item.userId,
    moderator: item.reviewerId || "—",
    at: item.updatedAt || item.createdAt
  }));

  return [...moderation, ...applications]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 100);
}

export function registerDashboardRoutes(client) {
  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "discord-dashboard-api",
      botReady: client.isReady(),
      time: new Date().toISOString()
    });
  });

  app.get("/auth/discord", (_request, response) => {
    if (!sessionSecret || !discordClientSecret || !discordRedirectUri) {
      return response.status(503).send("Discord OAuth is not configured yet.");
    }

    const state = crypto.randomBytes(24).toString("hex");

    response.setHeader(
      "Set-Cookie",
      `oauth_state=${state}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`
    );

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: discordRedirectUri,
      response_type: "code",
      scope: "identify guilds",
      state
    });

    response.redirect(`https://discord.com/oauth2/authorize?${params}` );
  });

  app.get("/auth/discord/callback", async (request, response) => {
    try {
      const storedState = cookies(request).oauth_state;

      if (
        !request.query.code ||
        !request.query.state ||
        !storedState ||
        request.query.state !== storedState
      ) {
        return response.status(400).send("OAuth state or code is invalid.");
      }

      const tokenResponse = await fetch(
        "https://discord.com/api/v10/oauth2/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: discordClientSecret,
            grant_type: "authorization_code",
            code: String(request.query.code ),
            redirect_uri: discordRedirectUri
          })
        }
      );

      if (!tokenResponse.ok) {
        const details = await tokenResponse.text();
        throw new Error(`Discord token exchange failed: ${details}`);
      }

      const token = await tokenResponse.json();
      const discordHeaders = {
        Authorization: `Bearer ${token.access_token}`
      };

      const [userResponse, guildsResponse] = await Promise.all([
        fetch("https://discord.com/api/v10/users/@me", {
          headers: discordHeaders
        } ),
        fetch("https://discord.com/api/v10/users/@me/guilds", {
          headers: discordHeaders
        } )
      ]);

      if (!userResponse.ok || !guildsResponse.ok) {
        throw new Error("Discord identity lookup failed.");
      }

      const user = await userResponse.json();
      const guilds = await guildsResponse.json();
      const guild = guilds.find(item => item.id === config.guildId);
      const ownerIds = String(process.env.OWNER_DISCORD_ID || "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);

      const isAdmin = Boolean(
        guild &&
          ((BigInt(guild.permissions || "0") &
            BigInt(PermissionFlagsBits.Administrator)) !==
            0n ||
            ownerIds.includes(user.id))
      );

      if (!isAdmin) {
        return response
          .status(403)
          .send("You must be a server administrator to use this dashboard.");
      }

      const session = createSession({
        userId: user.id,
        username: user.username,
        guildId: config.guildId
      });

      const handoff = createOAuthHandoff(session);

      response.redirect(`${dashboardOrigin()}#oauth=${handoff}`);
    } catch (error) {
      console.error("Discord OAuth failed:", error);
      response.status(500).send("Discord login failed. Check the API logs.");
    }
  });

  app.post("/auth/handoff", (request, response) => {
    const session = takeOAuthHandoff(request.body?.token);

    if (!session) {
      return response
        .status(401)
        .json({ error: "OAuth handoff expired or already used." });
    }

    response.json({ session });
  });

  app.post("/auth/logout", (_request, response) => {
    clearCookie(response, "dashboard_session");
    response.status(204).end();
  });

  app.get("/api/me", requireSession, (request, response) => {
    const guild = guildFor(client);

    response.json({
      id: request.dashboardSession.userId,
      username: request.dashboardSession.username,
      guildId: config.guildId,
      guildName: guild?.name || "Connected server"
    });
  });

  app.get("/api/status", requireSession, (_request, response) => {
    const guild = guildFor(client);

    response.json({
      online: client.isReady(),
      guildName: guild?.name || "Unknown server",
      guildId: config.guildId,
      memberCount: guild?.memberCount || 0
    });
  });

  app.get("/api/activity", requireSession, (_request, response) => {
    response.json(activity(client));
  });

  app.get("/api/settings", requireSession, (_request, response) => {
    response.json(effectiveSettings(guildSettings(config.guildId)));
  });

  app.put("/api/settings", requireSession, (request, response) => {
    const saved = saveGuildSettings(
      config.guildId,
      cleanSettings(request.body)
    );

    response.json(effectiveSettings(saved));
  });

  app.get("/api/channels", requireSession, (_request, response) => {
    const guild = guildFor(client);

    if (!guild) {
      return response
        .status(503)
        .json({ error: "Bot is not connected to the configured guild." });
    }

    response.json({
      channels: [...guild.channels.cache.values()]
        .filter(channel => channel.isTextBased() && !channel.isThread())
        .map(channel => ({
          id: channel.id,
          name: channel.name,
          type: channel.type
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      roles: [...guild.roles.cache.values()]
        .filter(role => !role.managed)
        .map(role => ({
          id: role.id,
          name: role.name,
          position: role.position
        }))
        .sort((a, b) => b.position - a.position)
    });
  });

  app.get("/api/applications", requireSession, (request, response) => {
    response.json(
      listApplications(config.guildId, String(request.query.status || ""))
    );
  });

  app.post(
    "/api/applications/:id/:decision",
    requireSession,
    async (request, response) => {
      try {
        const guild = guildFor(client);
        const application = getApplication(config.guildId, request.params.id);

        if (!guild || !application) {
          return response.status(404).json({ error: "Application not found." });
        }

        const settings = effectiveSettings(guildSettings(config.guildId));
        const type = settings.applicationTypes.find(
          item => item.id === application.typeId
        );
        const member = await guild.members.fetch(
          request.dashboardSession.userId
        );

        if (!type || !(await isReviewer(member, settings, type))) {
          return response
            .status(403)
            .json({ error: "You are not allowed to review applications." });
        }

        const decision = String(request.params.decision);

        if (!["approved", "denied", "changes_requested"].includes(decision)) {
          return response.status(400).json({
            error: "Invalid review decision."
          });
        }

        const result = await reviewApplication({
          client,
          guildId: config.guildId,
          applicationId: application.id,
          decision,
          reviewerId: request.dashboardSession.userId
        });

        response.json(result);
      } catch (error) {
        console.error("Dashboard review failed:", error);
        response
          .status(500)
          .json({ error: error.message || "Review failed." });
      }
    }
  );

  app.post("/api/panel/publish", requireSession, async (_request, response) => {
    try {
      const settings = effectiveSettings(guildSettings(config.guildId));

      if (!settings.applicationPanelChannelId) {
        return response
          .status(400)
          .json({ error: "Choose a panel channel first." });
      }

      const channel = await client.channels.fetch(
        settings.applicationPanelChannelId
      );

      if (!channel?.isTextBased()) {
        return response
          .status(400)
          .json({ error: "The panel channel is not text-based." });
      }

      if (
        settings.applicationPanelDeleteOld &&
        settings.applicationPanelMessageId
      ) {
        const oldMessage = await channel.messages
          .fetch(settings.applicationPanelMessageId)
          .catch(() => null);
        await oldMessage?.delete().catch(() => {});
      }

      const message = await channel.send(buildApplicationPanel(settings));
      const saved = saveGuildSettings(config.guildId, {
        applicationPanelMessageId: message.id
      });

      response.json({
        ok: true,
        messageId: message.id,
        settings: effectiveSettings(saved)
      });
    } catch (error) {
      console.error("Panel publish failed:", error);
      response
        .status(500)
        .json({ error: error.message || "Panel publish failed." });
    }
  });
}

export function startDashboardApi(client) {
  registerDashboardRoutes(client);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => {
      console.log(`Dashboard API listening on 127.0.0.1:${port}`);
      resolve(server);
    });

    server.once("error", reject);
  });
}

app.use((error, _request, response, _next) => {
  console.error("API error:", error.message);
  response.status(500).json({ error: "API request failed" });
});
