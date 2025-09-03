import { renderLoginPage } from "./templates/login.js";
import { renderDashboardPage } from "./templates/dashboard.js";

/**
 * HTML for the login and dashboard views lives in ./templates/.
 * Update those files to modify UI markup without touching worker logic.
 */

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

const programRows = programsCsv
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => line.split(","));

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
      return new Response(renderDashboardPage(schemaColumns, programRows), {
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

    return new Response(renderLoginPage(), {
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
  },
};
