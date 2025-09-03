import { renderLoginPage } from "./templates/login.js";
import { renderProfilePage } from "./templates/profile.js";
import { exec } from "node:child_process";

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

async function ensureTables(db) {
  await db.exec("CREATE TABLE IF NOT EXISTS programs (id INTEGER PRIMARY KEY)");
  await db.exec(
    "CREATE TABLE IF NOT EXISTS profiles (username TEXT PRIMARY KEY, data TEXT)"
  );
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
  <p><a href="/profile">Back to profile</a></p>
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
    await ensureTables(env.DB);

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
              `session=${encodeURIComponent(user)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
            Location: "/profile",
          },
        });
      }
      record.count++;
      record.time = now;
      loginAttempts.set(ip, record);
      return new Response("Unauthorized", { status: 401 });
    }

    if (url.pathname === "/profile") {
      if (!loggedIn) {
        return new Response("", {
          status: 302,
          headers: { Location: "/" },
        });
      }
      if (request.method === "POST") {
        const form = await request.formData();
        const input = (form.get("input") || "").toString();
        const out = (form.get("out") || "").toString();
        try {
          await new Promise((resolve, reject) => {
            exec(
              `python3 wrangle_grants.py --input ${input} --out ${out}`,
              (err, stdout, stderr) => {
                if (err) {
                  reject(stderr || err.message);
                } else {
                  resolve(stdout);
                }
              }
            );
          });
          return new Response(renderProfilePage("CSV cleaned"), {
            headers: { "content-type": "text/html; charset=UTF-8" },
          });
        } catch (err) {
          return new Response(
            renderProfilePage(`Error: ${err}`),
            {
              status: 500,
              headers: { "content-type": "text/html; charset=UTF-8" },
            }
          );
        }
      }
      return new Response(renderProfilePage(), {
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
          headers: { Location: "/profile" },
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
      const profileRaw = await env.DB.prepare(
        "SELECT data FROM profiles WHERE username = ?"
      )
        .bind(username)
        .first("data");
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

