
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

function normalizeNumber(value) {
  if (value === undefined || value === null) return NaN;
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const cleaned = value.replace(/[$,]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

function detectDeadlineColumn(columns) {
  return columns.find((c) => {
    const lowered = c.toLowerCase();
    return lowered.includes("deadline") || lowered.includes("cohort");
  });
}

function detectFundingColumn(columns) {
  return columns.find((c) => {
    const lowered = c.toLowerCase();
    return lowered.includes("funding") || lowered.includes("amount");
  });
}

function computeSummary(records, columns) {
  const summary = { totalFunding: null, nextDeadline: null };
  const fundingCol = detectFundingColumn(columns);
  if (fundingCol) {
    const total = records
      .map((r) => normalizeNumber(r[fundingCol]))
      .filter((n) => Number.isFinite(n))
      .reduce((acc, n) => acc + n, 0);
    if (Number.isFinite(total)) {
      summary.totalFunding = total;
    }
  }

  const deadlineCol = detectDeadlineColumn(columns);
  if (deadlineCol) {
    const now = new Date();
    const upcoming = records
      .map((r) => new Date(r[deadlineCol]))
      .filter((d) => d instanceof Date && !Number.isNaN(d.getTime()) && d >= now)
      .sort((a, b) => a.getTime() - b.getTime());
    if (upcoming.length > 0) {
      summary.nextDeadline = upcoming[0].toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  }

  return summary;
}

function rowMatchesQuery(row, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return Object.values(row).some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(needle)
  );
}


const SESSION_TTL = 86400; // 24 hours in seconds

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
        return new Response(JSON.stringify({ error: "Username must be 3–32 characters." }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (!/^[a-zA-Z0-9_]+$/.test(newUser)) {
        return new Response(JSON.stringify({ error: "Username may only contain letters, numbers, and underscores." }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (!newPass || newPass.length < 6) {
        return new Response(JSON.stringify({ error: "Password must be at least 6 characters." }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (newPass !== confirmPass) {
        return new Response(JSON.stringify({ error: "Passwords do not match." }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
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
        return new Response(JSON.stringify({ error: "Username is already taken." }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      }

      const hash = await hashPassword(newPass);
      await env.GRANT_MANAGER_DB.prepare(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
      ).bind(newUser, hash, Date.now()).run();

      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
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
        return new Response(JSON.stringify(profile), { headers: { "content-type": "application/json" } });
      }
      if (request.method === "POST") {
        const body = await request.json();
        await env.USER_PROFILES.put(`profile:${username}`, JSON.stringify(body));
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }
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

      // Keywords derived from user profile for text matching
      const focusAreas = profile.focusAreas || [];
      const orgType = profile.orgType || "";
      const stage = profile.stage || "";

      // Build a keyword set from profile for matching against grant text
      const keywords = [
        ...focusAreas.map(f => f.toLowerCase()),
        orgType.toLowerCase(),
        stage.toLowerCase(),
      ].filter(Boolean);

      const columns = await getColumns(env.GRANT_MANAGER_DB);
      let results = [];
      if (columns.length > 0) {
        const { results: rows } = await env.GRANT_MANAGER_DB.prepare(
          `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM programs`
        ).all();
        results = rows
          .map((r) => {
            // Combine searchable text fields from the grant
            const grantText = [r.Name, r.Sponsor, r["Eligibility (key conditions)"], r.Benefits, r["Notes/Actions"]]
              .join(" ").toLowerCase();

            // Keyword overlap score (0–5 points)
            let keywordScore = 0;
            for (const kw of keywords) {
              if (kw && grantText.includes(kw)) keywordScore += 1;
            }

            // Curator numeric scores (0–5 scale from data)
            const relevance = parseFloat(r.Relevance) || 0;
            const fit = parseFloat(r.Fit) || 0;
            const ease = parseFloat(r.Ease) || 0;
            const curatorScore = (relevance + fit + ease) / 3;

            // Deadline recency bonus (sooner = higher, within 1 year)
            let recency = 0;
            const deadline = r["Deadline/Next Cohort"] ? new Date(r["Deadline/Next Cohort"]) : null;
            if (deadline && !isNaN(deadline.getTime())) {
              const daysUntil = (deadline - Date.now()) / 86400000;
              if (daysUntil >= 0 && daysUntil <= 365) recency = 1 - daysUntil / 365;
            }

            // Weighted composite: keyword match weighted heavily when profile exists
            const hasProfile = keywords.length > 0;
            const score = hasProfile
              ? (keywordScore / Math.max(keywords.length, 1)) * 5 * 0.5
                + curatorScore * 0.35
                + recency * 0.15
              : curatorScore * 0.85 + recency * 0.15;

            return { ...r, score: Math.round(score * 100) / 100 };
          })
          .sort((a, b) => b.score - a.score);
      }
      return new Response(JSON.stringify(results), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api/me") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      return new Response(JSON.stringify({ username }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (!loggedIn) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!env.AI) {
        return new Response("AI binding not configured", { status: 503 });
      }
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

    return env.ASSETS.fetch(request);
  },
};

