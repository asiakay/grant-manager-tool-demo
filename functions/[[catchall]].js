const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const SESSION_TTL = 86400; // 24 hours in seconds

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
  return wn.Relevance      * (parseFloat(r.Relevance) || 0)
       + wn.Fit            * (parseFloat(r.Fit) || 0)
       + wn.Ease           * (parseFloat(r.Ease) || 0)
       + wn.StackAlignment * (computeStackAlignment(r) * 3)
       + wn.CadenceRecency * (computeCadenceRecency(r) * 3);
}

async function resolveSession(env, cookie) {
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  if (!token || !env.USER_PROFILES) return null;
  const username = await env.USER_PROFILES.get(`session:${token}`);
  return username || null;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const cookie = request.headers.get("Cookie") || "";
  const username = await resolveSession(env, cookie);
  const loggedIn = !!username;

  // Signup
  if (url.pathname === "/signup" && request.method === "POST") {
    const form = await request.formData();
    const newUser = (form.get("username") || "").trim();
    const newPass = form.get("password") || "";
    const confirmPass = form.get("confirm_password") || "";

    if (!newUser || newUser.length < 3 || newUser.length > 32) {
      return new Response(JSON.stringify({ error: "Username must be 3–32 characters." }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(newUser)) {
      return new Response(JSON.stringify({ error: "Username may only contain letters, numbers, and underscores." }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }
    if (!newPass || newPass.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters." }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }
    if (newPass !== confirmPass) {
      return new Response(JSON.stringify({ error: "Passwords do not match." }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }

    if (!env.GRANT_MANAGER_DB) {
      return new Response(JSON.stringify({ error: "Database not configured." }), {
        status: 503, headers: { "content-type": "application/json" },
      });
    }

    await env.GRANT_MANAGER_DB.prepare(
      `CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`
    ).run();

    const demoHash = await hashPassword("demo");
    const defaultUsers = { demo: demoHash };
    const existing = await env.GRANT_MANAGER_DB.prepare(
      "SELECT username FROM users WHERE username = ?"
    ).bind(newUser).first();

    if (existing || defaultUsers[newUser]) {
      return new Response(JSON.stringify({ error: "Username is already taken." }), {
        status: 409, headers: { "content-type": "application/json" },
      });
    }

    const hash = await hashPassword(newPass);
    await env.GRANT_MANAGER_DB.prepare(
      "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
    ).bind(newUser, hash, Date.now()).run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 201, headers: { "content-type": "application/json" },
    });
  }

  // Login
  if (url.pathname === "/login" && request.method === "POST") {
    const demoHash = await hashPassword("demo");
    const defaultUsers = { demo: demoHash };
    let envUsers = {};
    if (env.USER_HASHES) {
      try {
        const raw = JSON.parse(env.USER_HASHES);
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

    const form = await request.formData();
    const user = form.get("username");
    const pass = form.get("password");
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    let record;
    if (env.LOGIN_ATTEMPTS) {
      record = await env.LOGIN_ATTEMPTS.get(ip, { type: "json" });
    }
    if (!record) record = { count: 0, time: now };
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
      if (env.GRANT_MANAGER_DB) {
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
      }
    } catch (err) {
      console.warn("D1 user lookup failed", err);
    }
    const dbMatch = dbUser && dbUser.password_hash === hashed;
    if ((users[user] && users[user] === hashed) || dbMatch) {
      if (env.LOGIN_ATTEMPTS) await env.LOGIN_ATTEMPTS.delete(ip);
      const token = crypto.randomUUID();
      if (env.USER_PROFILES) {
        await env.USER_PROFILES.put(`session:${token}`, user, { expirationTtl: SESSION_TTL });
      }
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return new Response("", {
        status: 302,
        headers: {
          "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=Lax${secure}`,
          Location: "/dashboard",
        },
      });
    }
    record.count++;
    record.time = now;
    if (env.LOGIN_ATTEMPTS) await env.LOGIN_ATTEMPTS.put(ip, JSON.stringify(record));
    return new Response("Unauthorized", { status: 401 });
  }

  // Logout
  if (url.pathname === "/logout") {
    const match = cookie.match(/session=([^;]+)/);
    if (match && env.USER_PROFILES) {
      await env.USER_PROFILES.delete(`session:${decodeURIComponent(match[1])}`);
    }
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return new Response("", {
      status: 302,
      headers: {
        "Set-Cookie": `session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`,
        Location: "/",
      },
    });
  }

  // API: profile
  if (url.pathname === "/api/profile") {
    if (!loggedIn) return new Response("Unauthorized", { status: 401 });
    if (request.method === "GET") {
      const raw = env.USER_PROFILES ? await env.USER_PROFILES.get(`profile:${username}`) : null;
      const profile = raw ? JSON.parse(raw) : null;
      return new Response(JSON.stringify(profile), {
        headers: { "content-type": "application/json" },
      });
    }
    if (request.method === "POST") {
      const body = await request.json();
      if (env.USER_PROFILES) {
        await env.USER_PROFILES.put(`profile:${username}`, JSON.stringify(body));
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }
  }

  // API: grants list
  if (url.pathname === "/api/grants") {
    if (!loggedIn) return new Response("Unauthorized", { status: 401 });
    if (!env.GRANT_MANAGER_DB) {
      return new Response(JSON.stringify([]), {
        headers: { "content-type": "application/json" },
      });
    }
    let profile = {};
    if (env.USER_PROFILES) {
      const profileRaw = await env.USER_PROFILES.get(`profile:${username}`);
      if (profileRaw) {
        try { profile = JSON.parse(profileRaw); } catch { profile = {}; }
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
    return new Response(JSON.stringify(results), {
      headers: { "content-type": "application/json" },
    });
  }

  // API: me
  if (url.pathname === "/api/me") {
    if (!loggedIn) return new Response("Unauthorized", { status: 401 });
    return new Response(JSON.stringify({ username }), {
      headers: { "content-type": "application/json" },
    });
  }

  // API: health
  if (url.pathname === "/api/health") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  // API: chat
  if (url.pathname === "/api/chat" && request.method === "POST") {
    if (!loggedIn) return new Response("Unauthorized", { status: 401 });
    if (!env.AI) return new Response("AI binding not configured", { status: 503 });
    const { messages } = await request.json();
    const result = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages: Array.isArray(messages)
        ? messages
        : [{ role: "user", content: String(messages || "") }],
      stream: false,
    });
    return new Response(JSON.stringify({ response: result.response }), {
      headers: { "content-type": "application/json" },
    });
  }

  // Data export (CSV)
  if (url.pathname === "/data") {
    if (!loggedIn) return new Response("Unauthorized", { status: 401 });
    if (!env.GRANT_MANAGER_DB) return new Response("", { headers: { "content-type": "text/csv" } });
    const columns = await getColumns(env.GRANT_MANAGER_DB);
    let body = "";
    if (columns.length > 0) {
      const { results } = await env.GRANT_MANAGER_DB.prepare(
        `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM programs`
      ).all();
      body = [
        columns.join(","),
        ...results.map((r) => columns.map((c) => r[c] ?? "").join(",")),
      ].join("\n");
    }
    return new Response(body, {
      headers: { "content-type": "text/csv; charset=UTF-8" },
    });
  }

  // Schema (column list)
  if (url.pathname === "/schema") {
    if (!env.GRANT_MANAGER_DB) return new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } });
    const columns = await getColumns(env.GRANT_MANAGER_DB);
    return new Response(JSON.stringify(columns), {
      headers: { "content-type": "application/json" },
    });
  }

  // Update notes for a single grant
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
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  // New schema entry
  if (url.pathname === "/new_schema") {
    if (!loggedIn) {
      return new Response("", { status: 302, headers: { Location: "/" } });
    }
    if (request.method === "POST") {
      if (!env.GRANT_MANAGER_DB) return new Response("Database not configured", { status: 503 });
      const columns = await getColumns(env.GRANT_MANAGER_DB);
      const form = await request.formData();
      const values = columns.map((c) => form.get(c) || "");
      const placeholders = columns.map(() => "?").join(",");
      const cols = columns.map((c) => `"${c}"`).join(",");
      await env.GRANT_MANAGER_DB.prepare(
        `INSERT OR REPLACE INTO programs (${cols}) VALUES (${placeholders})`
      )
        .bind(...values)
        .run();
      return new Response("", { status: 302, headers: { Location: "/dashboard" } });
    }
    return new Response("Method not allowed", { status: 405 });
  }

  // All other requests → serve static assets / SPA
  return next();
}
