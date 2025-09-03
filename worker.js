import { renderDashboardPage } from "./templates/dashboard.js";
import { renderLoginPage } from "./templates/login.js";

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
  await db.exec("CREATE TABLE IF NOT EXISTS programs (id INTEGER PRIMARY KEY)");
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
    const loggedIn = cookie.includes("session=active");
    const users = env.USER_HASHES ? JSON.parse(env.USER_HASHES) : {};
    await ensureProgramsTable(env.EQORE_DB);

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
        return new Response("", {
          status: 302,
          headers: {
            "Set-Cookie":
              "session=active; Path=/; HttpOnly; Secure; SameSite=Lax",
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
      const columns = await getColumns(env.EQORE_DB);
      let rows = [];
      if (columns.length > 0) {
        const { results } = await env.EQORE_DB.prepare(
          `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM programs`
        ).all();
        rows = results.map((r) => columns.map((c) => r[c] ?? ""));
      }
      return new Response(renderDashboardPage(columns, rows), {
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
        const columns = await getColumns(env.EQORE_DB);
        const form = await request.formData();
        const values = columns.map((c) => form.get(c) || "");
        const placeholders = columns.map(() => "?").join(",");
        const cols = columns.map((c) => `"${c}"`).join(",");
        await env.EQORE_DB.prepare(
          `INSERT OR REPLACE INTO programs (${cols}) VALUES (${placeholders})`
        )
          .bind(...values)
          .run();
        return new Response("", {
          status: 302,
          headers: { Location: "/dashboard" },
        });
      }
      return new Response(await newSchemaPage(env.EQORE_DB), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === "/schema") {
      const columns = await getColumns(env.EQORE_DB);
      return new Response(JSON.stringify(columns), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/data") {
      const columns = await getColumns(env.EQORE_DB);
      let body = "";
      if (columns.length > 0) {
        const { results } = await env.EQORE_DB.prepare(
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

    if (url.pathname === "/logout") {
      return new Response("", {
        status: 302,
        headers: {
          "Set-Cookie":
            "session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
          Location: "/",
        },
      });
    }

    return new Response(renderLoginPage(), {
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
  },
};

