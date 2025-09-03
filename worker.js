const users = {
  admin: "adminpass",
  user: "userpass",
};

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

function loginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Grant Login</title></head>
<body>
  <h1>Grant Wrangler Demo</h1>
  <form method="POST" action="/login">
    <label>Username <input name="username" /></label><br />
    <label>Password <input type="password" name="password" /></label><br />
    <button type="submit">Login</button>
  </form>
</body>
</html>`;
}

function dashboardPage() {
  const headerRow = schemaColumns.map((h) => `<th>${h}</th>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Dashboard</title></head>
<body>
  <h1>Program Data Schema</h1>
  <table border="1"><thead><tr>${headerRow}</tr></thead></table>
  <p>
    <a href="/schema">View schema JSON</a> |
    <a href="/data">Sample CSV</a> |
    <a href="/logout">Logout</a>
  </p>
</body>
</html>`;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cookie = request.headers.get("Cookie") || "";
    const loggedIn = cookie.includes("session=active");

    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      const user = form.get("username");
      const pass = form.get("password");
      if (users[user] === pass) {
        return new Response("", {
          status: 302,
          headers: {
            "Set-Cookie": "session=active; Path=/",
            Location: "/dashboard",
          },
        });
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
      return new Response(dashboardPage(), {
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
          "Set-Cookie": "session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
          Location: "/",
        },
      });
    }

    return new Response(loginPage(), {
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
  },
};
