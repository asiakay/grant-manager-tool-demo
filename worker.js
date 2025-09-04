import { renderDashboardPage } from "./ui/dashboard.js";
import { renderLoginPage } from "./ui/login.js";
import { renderTestEndpointsPage } from "./ui/test_endpoints.js";

const loginAttempts = new Map();
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

async function ensureProgramsTable(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS programs (
    "Type" TEXT,
    "Name" TEXT PRIMARY KEY,
    "Sponsor" TEXT,
    "Source URL" TEXT,
    "Region / Eligibility" TEXT,
    "Deadline / Next Cohort" TEXT,
    "Cadence" TEXT,
    "Benefits" TEXT,
    "Eligibility (key conditions)" TEXT,
    "Stage" TEXT,
    "Non-dilutive?" TEXT,
    "Stack Required?" TEXT,
    "Relevance" TEXT,
    "Fit" TEXT,
    "Ease" TEXT,
    "Weighted Score" TEXT,
    "Notes / Actions" TEXT
  );`);
}

async function newSchemaPage(db) {
  const columns = await getColumns(db);
  const inputs = columns
    .map((c) => `<label>${c} <input name="${c}" /></label><br />`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>New Schema Entry</title></head>
<body>
  <h1>Add Schema Entry</h1>
  <form method="POST" action="/new_schema">
    ${inputs}
    <button type="submit">Save</button>
  </form>
  <p><a href="/dashboard">Back to dashboard</a></p>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cookie = request.headers.get("Cookie") || "";
    const sessionMatch = cookie.match(/session=([^;]+)/);
    const username = sessionMatch ? decodeURIComponent(sessionMatch[1]) : null;
    const loggedIn = !!username;
    const users = env.USER_HASHES ? JSON.parse(env.USER_HASHES) : {};
    await ensureProgramsTable(env.DB);

    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      const user = form.get("username");
      const pass = form.get("password");
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const now = Date.now();
      const record = loginAttempts.get(ip) || { count: 0, time: now };
      if (now - record.time > LOCKOUT_MS) {
        record.count = 0;
        record.time = now;
      }
      if (record.count >= MAX_ATTEMPTS) {
        return new Response("Too many attempts. Try again later.", { status: 429 });
      }
      const hashed = await hashPassword(pass || "");
      if (users[user] && users[user] === hashed) {
        loginAttempts.delete(ip);
        const secure = url.protocol === "https:" ? "; Secure" : "";
        return new Response("", {
          status: 302,
          headers: {
            "Set-Cookie":
              `session=${encodeURIComponent(user)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
            Location: "/dashboard",
          },
        });
      }
      record.count++;
      record.time = now;
      loginAttempts.set(ip, record);
      return new Response("Unauthorized", { status: 401 });
    }

    if (url.pathname === "/dashboard") {
      if (!loggedIn) {
        return new Response("", {
          status: 302,
          headers: { Location: "/" },
        });
      }
      const columns = await getColumns(env.DB);
      let rows = [];
      if (columns.length > 0) {
        const { results } = await env.DB.prepare(
          `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM programs`
        ).all();
        rows = results.map((r) => columns.map((c) => r[c] ?? ""));
      }
      let profile = {};
      let profileRaw = null;
      if (env.USER_PROFILES) {
        profileRaw = await env.USER_PROFILES.get(username);
      } else {
        console.warn("USER_PROFILES binding is not configured");
      }
      if (profileRaw) {
        try {
          profile = JSON.parse(profileRaw);
        } catch {
          profile = {};
        }
      }
      return new Response(renderDashboardPage(columns, rows, username, profile), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

      if (url.pathname === "/test-endpoints") {
        if (!loggedIn) {
          return new Response("", {
            status: 302,
            headers: { Location: "/" },
          });
        }
        return new Response(renderTestEndpointsPage(username), {
          headers: { "content-type": "text/html; charset=UTF-8" },
        });
      }

    if (url.pathname === "/new_schema") {
      if (!loggedIn) {
        return new Response("", {
          status: 302,
          headers: { Location: "/" },
        });
      }
      if (request.method === "POST") {
        const columns = await getColumns(env.DB);
        const form = await request.formData();
        const values = columns.map((c) => form.get(c) || "");
        const placeholders = columns.map(() => "?").join(",");
        const cols = columns.map((c) => `"${c}"`).join(",");
        await env.DB.prepare(
          `INSERT OR REPLACE INTO programs (${cols}) VALUES (${placeholders})`
        )
          .bind(...values)
          .run();
        return new Response("", {
          status: 302,
          headers: { Location: "/dashboard" },
        });
      }
      return new Response(await newSchemaPage(env.DB), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === "/schema") {
      const columns = await getColumns(env.DB);
      return new Response(JSON.stringify(columns), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/data") {
      const columns = await getColumns(env.DB);
      let body = "";
      if (columns.length > 0) {
        const { results } = await env.DB.prepare(
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

    if (url.pathname === "/api/grants") {
      if (!loggedIn) {
        return new Response("Unauthorized", { status: 401 });
      }
      let profileRaw = null;
      if (env.USER_PROFILES) {
        profileRaw = await env.USER_PROFILES.get(username);
      } else {
        console.warn("USER_PROFILES binding is not configured");
        return new Response("USER_PROFILES binding not configured", { status: 500 });
      }
      let profile = {};
      if (profileRaw) {
        try {
          profile = JSON.parse(profileRaw);
        } catch (err) {
          profile = {};
        }
      }
      const columns = await getColumns(env.DB);
      let results = [];
      if (columns.length > 0) {
        const { results: rows } = await env.DB.prepare(
          `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM programs`
        ).all();
        results = rows
          .map((r) => {
            let score = 0;
            for (const [field, weight] of Object.entries(profile)) {
              const val = Number(r[field]) || 0;
              score += val * Number(weight);
            }
            return { ...r, score };
          })
          .sort((a, b) => b.score - a.score);
      }
      return new Response(JSON.stringify(results), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/logout") {
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

    if (url.pathname === "/" && loggedIn) {
      return new Response("", { status: 302, headers: { Location: "/dashboard" } });
    }

    return new Response(renderLoginPage(), {
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
  },
};

