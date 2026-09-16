export async function onRequestGet({ request, env }) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Login required." }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const token = authHeader.slice(7);

  let payload;
  try {
    payload = await verifyJWT(token, env.DASHBOARD_JWT_SECRET);
  } catch {
    return new Response(JSON.stringify({ error: "Login required." }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const botToken = env.DISCORD_BOT_TOKEN;
  const clientId = env.DISCORD_CLIENT_ID;

  if (!botToken) {
    return new Response(JSON.stringify({ error: "Server configuration error." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const botGuildsResponse = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: { Authorization: `Bot ${botToken}` }
  });

  const botGuilds = botGuildsResponse.ok ? await botGuildsResponse.json() : [];
  const botGuildIds = new Set(botGuilds.map(g => g.id));

  const jwtGuilds = payload.guilds || [];

  const servers = jwtGuilds.map(guild => {
    const guildId = guild.id || guild.guild_id;
    const isOwner = guild.role === "owner";
    const isAdmin = isOwner || guild.role === "admin";
    const botInstalled = botGuildIds.has(guildId);

    return {
      id: guildId,
      name: guild.name || "Unknown Server",
      icon: guild.icon || null,
      botInstalled,
      inviteUrl: clientId ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8` : null,
      accessRole: isOwner ? "owner" : isAdmin ? "admin" : "member",
      permissions: { serverSwitch: isOwner || isAdmin }
    };
  });

  return new Response(JSON.stringify({ servers }), {
    headers: { "Content-Type": "application/json" }
  });
}

async function verifyJWT(token, secret) {
  if (!secret) throw new Error("No JWT secret");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");

  const header = JSON.parse(base64urlDecode(parts[0]));
  const payload = JSON.parse(base64urlDecode(parts[1]));
  const signature = base64urlDecode(parts[2]);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const data = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const valid = await crypto.subtle.verify("HMAC", key, signature, data);
  if (!valid) throw new Error("Invalid signature");

  return payload;
}

function base64urlDecode(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  return atob(base64 + padding);
}
