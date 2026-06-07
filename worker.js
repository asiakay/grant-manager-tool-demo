
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

async function hashPassword(pass) {
  const data = new TextEncoder().encode(pass);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getColumns(db) {
  const { results } = await db.prepare("PRAGMA table_info(programs)").all();
  return results.map((r) => r.name);
}

const DEFAULT_WEIGHTS = { Relevance: 0.3, Fit: 0.3, Ease: 0.2, StackAlignment: 0.1, CadenceRecency: 0.1 };

function computeStackAlignment(r) {
  const s = String(r["Stack Required?"] || "").toLowerCase().trim();
  return (s === "yes" || s === "y") ? 1.0 : 0.2;
}

function computeCadenceRecency(r) {
  const cadence = String(r["Cadence"] || "").toLowerCase();
  if (cadence.includes("rolling")) return 1.0;
  const raw = r["Deadline/Next Cohort"] || r["Deadline / Next Cohort"];
  if (!raw) return 0;
  const deadline = new Date(raw);
  if (isNaN(deadline.getTime())) return 0;
  const daysUntil = (deadline.getTime() - Date.now()) / 86400000;
  return Math.max(0, Math.min(1, 1 - daysUntil / 365));
}

function computeScore(r, weights) {
  const w = weights || DEFAULT_WEIGHTS;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const wn = {
    Relevance:      (w.Relevance ?? 0) / total,
    Fit:            (w.Fit ?? 0) / total,
    Ease:           (w.Ease ?? 0) / total,
    StackAlignment: (w.StackAlignment ?? 0) / total,
    CadenceRecency: (w.CadenceRecency ?? 0) / total,
  };
  const relevance  = parseFloat(r.Relevance) || 0;
  const fit        = parseFloat(r.Fit) || 0;
  const ease       = parseFloat(r.Ease) || 0;
  const stack      = computeStackAlignment(r);
  const cadence    = computeCadenceRecency(r);
  // Relevance/Fit/Ease are 0-3; stack and cadence are 0-1.
  // Multiply stack/cadence by 3 so all components share the same scale.
  return wn.Relevance * relevance
       + wn.Fit * fit
       + wn.Ease * ease
       + wn.StackAlignment * (stack * 3)
       + wn.CadenceRecency * (cadence * 3);
}

const SESSION_TTL = 86400; // 24 hours in seconds

function jsonResponse(body, init = {}) {
  const status = init.status ?? 200;
  const extra = init.headers ?? {};
  return new Response(body, {
    ...init,
    status,
    headers: {
      "content-type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

async function resolveSession(env, cookie) {
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  if (!token || !env.USER_PROFILES) return null;
  const username = await env.USER_PROFILES.get(`session:${token}`);
  return username || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cookie = request.headers.get("Cookie") || "";
    const username = await resolveSession(env, cookie);
    const loggedIn = !!username;
    // Hash the password at runtime so it always matches the same algorithm
    // used for incoming login attempts. Environment-provided users may supply
    // either hashed or plain-text passwords; the latter are hashed here so the
    // configuration is more forgiving in development setups.
    const demoHash = await hashPassword("demo");
    const defaultUsers = { demo: demoHash };
    let envUsers = {};
    if (env.USER_HASHES) {
      try {
        const raw = JSON.parse(env.USER_HASHES);
        envUsers = {};
        for (const [u, secret] of Object.entries(raw)) {
          envUsers[u] = /^[0-9a-f]{64}$/i.test(secret)
            ? secret.toLowerCase()
            : await hashPassword(secret);
        }
      } catch (err) {
        console.warn("Invalid USER_HASHES value", err);
      }
    }

    const users = { ...defaultUsers, ...envUsers };

    if (url.pathname === "/signup" && request.method === "POST") {
      const form = await request.formData();
      const newUser = (form.get("username") || "").trim();
      const newPass = form.get("password") || "";
      const confirmPass = form.get("confirm_password") || "";

      if (!newUser || newUser.length < 3 || newUser.length > 32) {
        return jsonResponse(JSON.stringify({ error: "Username must be 3–32 characters." }), { status: 400 });
      }
      if (!/^[a-zA-Z0-9_]+$/.test(newUser)) {
        return jsonResponse(JSON.stringify({ error: "Username may only contain letters, numbers, and underscores." }), { status: 400 });
      }
      if (!newPass || newPass.length < 6) {
        return jsonResponse(JSON.stringify({ error: "Password must be at least 6 characters." }), { status: 400 });
      }
      if (newPass !== confirmPass) {
        return jsonResponse(JSON.stringify({ error: "Passwords do not match." }), { status: 400 });
      }

      await env.GRANT_MANAGER_DB.prepare(
        `CREATE TABLE IF NOT EXISTS users (
          username TEXT PRIMARY KEY,
          password_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`
      ).run();

      const existing = await env.GRANT_MANAGER_DB.prepare(
        "SELECT username FROM users WHERE username = ?"
      ).bind(newUser).first();

      if (existing || users[newUser]) {
        return jsonResponse(JSON.stringify({ error: "Username is already taken." }), { status: 409 });
      }

      const hash = await hashPassword(newPass);
      await env.GRANT_MANAGER_DB.prepare(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
      ).bind(newUser, hash, Date.now()).run();

      return jsonResponse(JSON.stringify({ ok: true }), { status: 201 });
    }

    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      const user = form.get("username");
      const pass = form.get("password");
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const now = Date.now();
      let record;
      if (env.LOGIN_ATTEMPTS) {
        record = await env.LOGIN_ATTEMPTS.get(ip, { type: "json" });
      } else {
        console.warn("LOGIN_ATTEMPTS binding is not configured");
      }
      if (!record) {
        record = { count: 0, time: now };
      }
      if (now - record.time > LOCKOUT_MS) {
        record.count = 0;
        record.time = now;
      }
      if (record.count >= MAX_ATTEMPTS) {
        return new Response("Too many attempts. Try again later.", { status: 429 });
      }
      const hashed = await hashPassword(pass || "");
      let dbUser = null;
      try {
        await env.GRANT_MANAGER_DB.prepare(
          `CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )`
        ).run();
        dbUser = await env.GRANT_MANAGER_DB.prepare(
          "SELECT password_hash FROM users WHERE username = ?"
        ).bind(user).first();
      } catch (err) {
        console.warn("D1 user lookup failed", err);
      }
      const dbMatch = dbUser && dbUser.password_hash === hashed;
      if ((users[user] && users[user] === hashed) || dbMatch) {
        if (env.LOGIN_ATTEMPTS) {
          await env.LOGIN_ATTEMPTS.delete(ip);
        }
        const token = crypto.randomUUID();
        if (env.USER_PROFILES) {
          await env.USER_PROFILES.put(`session:${token}`, user, { expirationTtl: SESSION_TTL });
        }
        const secure = url.protocol === "https:" ? "; Secure" : "";
        return new Response("", {
          status: 302,
          headers: {
            "Set-Cookie":
              `session=${token}; Path=/; HttpOnly; SameSite=Lax${secure}`,
            Location: "/dashboard",
          },
        });
      }
      record.count++;
      record.time = now;
      if (env.LOGIN_ATTEMPTS) {
        await env.LOGIN_ATTEMPTS.put(ip, JSON.stringify(record));
      }
      return new Response("Unauthorized", { status: 401 });
    }

if (url.pathname === "/api/profile") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (request.method === "GET") {
        const raw = env.USER_PROFILES ? await env.USER_PROFILES.get(`profile:${username}`) : null;
        const profile = raw ? JSON.parse(raw) : null;
        return jsonResponse(JSON.stringify(profile));
      }
      if (request.method === "POST") {
        const body = await request.json();
        await env.USER_PROFILES.put(`profile:${username}`, JSON.stringify(body));
        return jsonResponse(JSON.stringify({ ok: true }));
      }
    }

    if (url.pathname === "/api/ai-status") {
      const hasBinding = !!env.AI;
      const hasRestApi = !!(env.CF_ACCOUNT_ID && env.CF_AI_TOKEN);
      const configured = hasBinding || hasRestApi;
      const provider = configured ? "workers-ai" : null;
      return jsonResponse(JSON.stringify({ configured, provider }));
    }

    if (url.pathname === "/api/grants") {
      if (!loggedIn) {
        return new Response("Unauthorized", { status: 401 });
      }
      let profile = {};
      if (env.USER_PROFILES) {
        const raw = await env.USER_PROFILES.get(`profile:${username}`);
        if (raw) {
          try { profile = JSON.parse(raw); } catch { profile = {}; }
        }
      }

      const userWeights = (profile.weights && typeof profile.weights === "object")
        ? profile.weights
        : null;

      const columns = await getColumns(env.GRANT_MANAGER_DB);
      let results = [];
      if (columns.length > 0) {
        const { results: rows } = await env.GRANT_MANAGER_DB.prepare(
          `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM programs`
        ).all();
        results = rows
          .map((r) => ({
            ...r,
            score: Math.round(computeScore(r, userWeights) * 100) / 100,
          }))
          .sort((a, b) => b.score - a.score);
      }
      return jsonResponse(JSON.stringify(results));
    }

    if (url.pathname === "/api/me") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      return jsonResponse(JSON.stringify({ username }));
    }

    if (url.pathname === "/api/health") {
      return jsonResponse(JSON.stringify({ ok: true }));
    }

    if (url.pathname === "/api/notes" && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!env.GRANT_MANAGER_DB) return new Response("Database not configured", { status: 503 });
      const form = await request.formData();
      const name = form.get("Name");
      const notes = form.get("Notes/Actions") ?? "";
      if (!name) return new Response("Missing Name", { status: 400 });
      await env.GRANT_MANAGER_DB.prepare(
        `UPDATE programs SET "Notes/Actions" = ? WHERE "Name" = ?`
      )
        .bind(notes, name)
        .run();
      return jsonResponse(JSON.stringify({ ok: true }));
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (!loggedIn) {
        return new Response("Unauthorized", { status: 401 });
      }
      const { messages } = await request.json();
      const chatMessages = Array.isArray(messages)
        ? messages
        : [{ role: "user", content: String(messages || "") }];

      // Try native AI binding first, then fall back to REST API
      if (env.AI) {
        const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: chatMessages,
          stream: false,
        });
        return jsonResponse(JSON.stringify({ response: result.response }));
      }

      if (env.CF_ACCOUNT_ID && env.CF_AI_TOKEN) {
        const aiRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.CF_AI_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ messages: chatMessages }),
          }
        );
        if (!aiRes.ok) {
          const errText = await aiRes.text().catch(() => "");
          return new Response(`AI request failed: ${errText}`, { status: 502 });
        }
        const data = await aiRes.json();
        const text = data.result?.response ?? "";
        return jsonResponse(JSON.stringify({ response: text }));
      }

      return new Response("AI not configured", { status: 503 });
    }

    if (url.pathname === "/logout") {
      const match = cookie.match(/session=([^;]+)/);
      if (match && env.USER_PROFILES) {
        await env.USER_PROFILES.delete(`session:${decodeURIComponent(match[1])}`);
      }
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return new Response("", {
        status: 302,
        headers: {
          "Set-Cookie":
            `session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`,
          Location: "/",
        },
      });
    }

    const assetRes = await env.ASSETS.fetch(request);
    const newHeaders = new Headers(assetRes.headers);
    newHeaders.set("X-Content-Type-Options", "nosniff");
    newHeaders.set("Cache-Control", "public, max-age=86400");
    return new Response(assetRes.body, { status: assetRes.status, headers: newHeaders });
  },
};

