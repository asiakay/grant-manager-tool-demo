const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const numberFormatter = new Intl.NumberFormat("en-US");

export function renderDashboardPage(
  headers = [],
  rows = [],
  username = "",
  profile = {}
) {
  const totalPrograms = rows.length;
  const previewLimit = 25;
  const previewRows = rows.slice(0, previewLimit);
  const weightedColumns = new Set(Object.keys(profile));
  const highlightedHeaders = headers.map((header) => {
    const label = escapeHtml(header);
    const weighted = weightedColumns.has(header) ? " weighted" : "";
    return `<th scope="col" class="table__header${weighted}">${label}</th>`;
  });

  const tableBody = previewRows
    .map((cols, rowIndex) => {
      const cells = cols
        .map((value, colIndex) => {
          const label = headers[colIndex] || `Column ${colIndex + 1}`;
          return `<td data-label="${escapeHtml(label)}">${escapeHtml(value)}</td>`;
        })
        .join("");
      return `<tr><td class="row-index">${rowIndex + 1}</td>${cells}</tr>`;
    })
    .join("");

  const emptyState =
    headers.length === 0
      ? `<tr><td colspan="2" class="empty">No schema defined in D1 yet.</td></tr>`
      : `<tr><td colspan="${headers.length + 1}" class="empty">No rows found for the current schema.</td></tr>`;

  const profileRows = Object.entries(profile)
    .map(([field, weight]) => {
      return `<tr><td>${escapeHtml(field)}</td><td>${escapeHtml(weight)}</td></tr>`;
    })
    .join("");

  const profileTable = profileRows
    ? profileRows
    : '<tr><td colspan="2" class="empty">No weights stored for this user. Add JSON in the <code>USER_PROFILES</code> KV to personalize scores.</td></tr>';

  const columnChips = headers
    .map((name) => {
      const weighted = weightedColumns.has(name) ? " chip--weighted" : "";
      return `<span class="chip${weighted}">${escapeHtml(name)}</span>`;
    })
    .join("");

  const previewNotice =
    totalPrograms > previewLimit
      ? `<p class="muted">Showing the first ${previewLimit} rows (${numberFormatter.format(
          totalPrograms
        )} total). Use the CSV download for the full dataset.</p>`
      : `<p class="muted">${numberFormatter.format(totalPrograms)} total rows in D1.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Grant Programs Dashboard</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --bg: #f5f6fb;
        --card: #ffffff;
        --border: #e1e3ec;
        --text: #1d2333;
        --muted: #5d6373;
        --accent: #5666ff;
        --accent-soft: rgba(86, 102, 255, 0.1);
        --success: #129a7e;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
      }
      .site-header {
        background: #0b1736;
        color: #fff;
        padding: 1.5rem 2rem;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
        justify-content: space-between;
      }
      .site-header h1 {
        margin: 0;
        font-size: 1.5rem;
      }
      .user-info {
        font-weight: 500;
      }
      .user-info span {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .user-info span::before {
        content: "•";
        color: var(--success);
      }
      .site-header nav a,
      .user-info a {
        color: #fff;
        text-decoration: none;
        font-weight: 600;
      }
      .site-header nav {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
      }
      main.layout {
        display: grid;
        grid-template-columns: 2fr minmax(320px, 1fr);
        gap: 1.5rem;
        padding: 2rem;
      }
      .panel {
        background: var(--card);
        border-radius: 16px;
        padding: 1.5rem;
        box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08);
      }
      .panel + .panel {
        margin-top: 1rem;
      }
      .overview-grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }
      .stat-card {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1rem;
      }
      .stat-card h3 {
        margin: 0;
        font-size: 0.95rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .stat-card strong {
        font-size: 1.75rem;
        display: block;
        margin-top: 0.25rem;
      }
      .muted {
        color: var(--muted);
        margin: 0.25rem 0 0 0;
      }
      .table-wrapper {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 1rem;
        font-size: 0.95rem;
      }
      th,
      td {
        border: 1px solid var(--border);
        padding: 0.65rem;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: #f7f8ff;
        font-weight: 600;
      }
      th.weighted {
        background: var(--accent-soft);
      }
      .row-index {
        font-weight: 600;
        width: 48px;
        text-align: center;
        background: #fafbff;
      }
      .empty {
        text-align: center;
        color: var(--muted);
        padding: 2rem 1rem;
      }
      .chip {
        display: inline-flex;
        padding: 0.35rem 0.75rem;
        border-radius: 999px;
        background: #f3f4fa;
        border: 1px solid var(--border);
        font-size: 0.85rem;
        margin: 0.25rem;
      }
      .chip--weighted {
        background: var(--accent-soft);
        border-color: var(--accent);
        color: var(--accent);
      }
      .profile-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 0.75rem;
      }
      .profile-table td,
      .profile-table th {
        border: 1px solid var(--border);
        padding: 0.5rem;
      }
      .profile-table th {
        text-transform: uppercase;
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        color: var(--muted);
        background: #f7f8ff;
      }
      .api-card {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1rem;
        margin-top: 1rem;
      }
      .api-card code {
        display: inline-flex;
        padding: 0.35rem 0.55rem;
        background: #f0f2ff;
        border-radius: 6px;
      }
      button.cta {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.65rem 1rem;
        border: none;
        border-radius: 999px;
        background: var(--accent);
        color: #fff;
        font-weight: 600;
        cursor: pointer;
        margin-top: 0.75rem;
      }
      button.cta:disabled {
        opacity: 0.65;
        cursor: wait;
      }
      pre {
        background: #050713;
        color: #e6e8ff;
        padding: 1rem;
        border-radius: 12px;
        max-height: 260px;
        overflow: auto;
        font-size: 0.85rem;
      }
      footer {
        padding: 2rem;
        text-align: center;
        color: var(--muted);
      }
      @media (max-width: 960px) {
        main.layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header class="site-header">
      <h1>Grant Programs Control Center</h1>
      <nav>
        <a href="/dashboard">Dashboard</a>
        <a href="/test-endpoints">API Explorer</a>
        <a href="/data">CSV Export</a>
        <a href="/schema">Schema JSON</a>
      </nav>
      <div class="user-info">
        <span>${escapeHtml(username)}</span>
        <a href="/logout" title="Log out">Logout</a>
      </div>
    </header>
    <main class="layout">
      <section class="panel">
        <h2>Pipeline Snapshot</h2>
        <div class="overview-grid">
          <article class="stat-card">
            <h3>Programs</h3>
            <strong>${numberFormatter.format(totalPrograms)}</strong>
            <p class="muted">Rows loaded from the <code>programs</code> table.</p>
          </article>
          <article class="stat-card">
            <h3>Schema Columns</h3>
            <strong>${numberFormatter.format(headers.length)}</strong>
            <p class="muted">Synced from the Grants.gov wrangling pipeline.</p>
          </article>
          <article class="stat-card">
            <h3>Weighted Fields</h3>
            <strong>${numberFormatter.format(weightedColumns.size)}</strong>
            <p class="muted">Used to score grants per your profile.</p>
          </article>
        </div>
        <div>${columnChips || '<p class="muted">Add a schema to see the normalized fields.</p>'}</div>
      </section>
      <section class="panel">
        <div class="section-header">
          <h2>Data Preview</h2>
          ${previewNotice}
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th scope="col" class="row-index">#</th>
                ${highlightedHeaders.join("")}
              </tr>
            </thead>
            <tbody>
              ${tableBody || emptyState}
            </tbody>
          </table>
        </div>
        <p class="muted">
          Need the full dataset? Download the <a href="/data">CSV snapshot</a> or call the
          <code>/api/grants</code> endpoint for JSON with profile-based scoring.
        </p>
      </section>
      <aside class="panel">
        <h2>Profile Weights</h2>
        <p class="muted">
          The worker looks up <code>USER_PROFILES</code> → <code>${escapeHtml(
            username
          )}</code> in KV. Each field weight multiplies the numeric value pulled from
          <code>programs</code> to compute a <em>score</em> for ranking.
        </p>
        <table class="profile-table">
          <thead>
            <tr><th>Field</th><th>Weight</th></tr>
          </thead>
          <tbody>${profileTable}</tbody>
        </table>
        <section class="api-card">
          <h3>API Inspector</h3>
          <p class="muted">Run the same JSON endpoint the worker exposes to front-end clients.</p>
          <button id="apiTestButton" class="cta">Run GET /api/grants</button>
          <p id="apiTestStatus" class="muted" aria-live="polite"></p>
          <pre id="apiTestOutput">Press the button to load data…</pre>
        </section>
        <section class="api-card">
          <h3>Useful Endpoints</h3>
          <ul>
            <li><code>GET /schema</code> – Returns the ordered column list.</li>
            <li><code>GET /data</code> – Streaming CSV export of the table.</li>
            <li><code>POST /new_schema</code> – Form helper for new rows.</li>
            <li><code>GET /api/grants</code> – JSON + score sorted desc.</li>
          </ul>
        </section>
      </aside>
    </main>
    <footer>
      Data pipeline: search → wrangle → summarize → D1 dashboard. Keep the worker deployed for the latest scores.
    </footer>
    <script>
      const statusEl = document.getElementById('apiTestStatus');
      const outputEl = document.getElementById('apiTestOutput');
      const buttonEl = document.getElementById('apiTestButton');
      if (buttonEl) {
        buttonEl.addEventListener('click', async () => {
          try {
            buttonEl.disabled = true;
            statusEl.textContent = 'Loading…';
            outputEl.textContent = '';
            const response = await fetch('/api/grants');
            const text = await response.text();
            try {
              const parsed = JSON.parse(text);
              outputEl.textContent = JSON.stringify(parsed.slice(0, 5), null, 2);
              statusEl.textContent = 'Fetched ' + parsed.length + ' grants.';
            } catch (err) {
              outputEl.textContent = text;
              statusEl.textContent = 'Received non-JSON response.';
            }
          } catch (err) {
            statusEl.textContent = 'Unable to load /api/grants';
            outputEl.textContent = String(err);
          } finally {
            buttonEl.disabled = false;
          }
        });
      }
    </script>
  </body>
</html>`;
}
