

const schemaColumns = [
  "Type",
  "Name",
  "Sponsor",
  "Source URL",
  "Region / Eligibility",
  "Deadline / Next Cohort",
  "Cadence",
  "Benefits",
  "Eligibility (key conditions)",
  "Stage",
  "Non-dilutive?",
  "Stack Required?",
  "Relevance",
  "Fit",
  "Ease",
  "Weighted Score",
  "Notes / Actions",
];

const programsCsv =
  "Type,Name,Sponsor,Source URL,Region / Eligibility,Deadline / Next Cohort,Cadence,Benefits,Eligibility (key conditions),Stage,Non-dilutive?,Stack Required?,Relevance,Fit,Ease,Weighted Score,Notes / Actions\n" +
  "program,Workers Launchpad,Cloudflare,https://www.cloudflare.com/lp/workers-launchpad/,Global; startups built on Workers,Quarterly cohorts; Demo Days; rolling intake,Quarterly,VC intros (40+ firms); founder bootcamps; Cloudflare engineering office hours; PM previews; community & Demo Day,Built core infra on Cloudflare Workers,Pre-seed–Series A,No (VC intros; not a grant),Yes (Workers required),5,5,5,,Confirm Workers usage; prepare 5-min pitch + traction bullets; follow cohort announcements";



function newSchemaPage() {
  const inputs = schemaColumns
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
      return new Response(renderDashboardPage(schemaColumns, programRows), {
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
        const form = await request.formData();
        const entry = schemaColumns.map((c) => form.get(c) || "");
        schemaEntries.push(entry);
        return new Response("", {
          status: 302,
          headers: { Location: "/dashboard" },
        });
      }
      return new Response(newSchemaPage(), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === "/schema") {
      return new Response(JSON.stringify(schemaColumns), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/data") {
      return new Response(programsCsv, {
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
