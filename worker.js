import { renderDashboardPage } from "./ui/dashboard.js";
import { renderLoginPage } from "./ui/login.js";
import { renderTestEndpointsPage } from "./ui/test_endpoints.js";

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
      if (users[user] && users[user] === hashed) {
        if (env.LOGIN_ATTEMPTS) {
          await env.LOGIN_ATTEMPTS.delete(ip);
        }
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
      if (env.LOGIN_ATTEMPTS) {
        await env.LOGIN_ATTEMPTS.put(ip, JSON.stringify(record));
      }
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
        records = results.map((r) =>
          columns.reduce((acc, col) => {
            acc[col] = r[col] ?? "";
            return acc;
          }, {})
        );
      }

      const filtered = records.filter((r) => rowMatchesQuery(r, query));
      const summary = computeSummary(filtered, columns);
      const previewRows = filtered.slice(0, limit);

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

      return new Response(
        renderDashboardPage({
          username,
          headers: columns,
          previewRows,
          query,
          limit,
          totalRows: filtered.length,
          summary,
          datasetLabel,
          sourceLabel,
          profile,
        }),
        {
          headers: { "content-type": "text/html; charset=UTF-8" },
        }
      );
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
      const columns = await getColumns(env.EQORE_DB);
      let results = [];
      if (columns.length > 0) {
        const { results: rows } = await env.EQORE_DB.prepare(
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

