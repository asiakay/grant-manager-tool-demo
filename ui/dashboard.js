const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }
  return currencyFormatter.format(value);
}

export function renderDashboardPage({
  username = "",
  headers = [],
  previewRows = [],
  query = "",
  limit = 25,
  totalRows = 0,
  summary = {},
  datasetLabel = "Programs",
  sourceLabel = "Cloudflare D1 table",
  profile = {},
} = {}) {
  const headerRow = headers.map((h) => `<th>${h}</th>`).join("");
  const bodyRows = previewRows
    .map(
      (row) =>
        `<tr>${headers
          .map((h) => `<td>${row[h] ?? ""}</td>`)
          .join("")}</tr>`
    )
    .join("");

  const profileEntries = Object.entries(profile)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  const profileHtml = profileEntries
    ? `<p class="muted">Profile weights: ${profileEntries}</p>`
    : "<p class=\"muted\">No custom profile weights.</p>";

  const rowsLabel = previewRows.length > 0 ? "Preview" : "No rows match the filters.";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Grant Manager Portal</title>
    <style>
      :root {
        font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
        color: #0f172a;
        background-color: #f8fafc;
      }
      body {
        margin: 0;
        padding: 0 0 3rem;
        background-color: #f8fafc;
      }
      header {
        background: linear-gradient(120deg, #0f172a, #1d4ed8);
        color: white;
        padding: 2.5rem 5vw 2rem;
      }
      header h1 {
        margin: 0 0 0.5rem 0;
        font-size: clamp(2rem, 4vw, 2.75rem);
      }
      header p {
        margin: 0;
        color: rgba(255, 255, 255, 0.85);
      }
      main {
        max-width: 1200px;
        margin: -2rem auto 0;
        background: white;
        border-radius: 1.5rem;
        padding: 2rem;
        box-shadow: 0 25px 50px rgba(15, 23, 42, 0.15);
      }
      .controls form {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: flex-end;
      }
      label {
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #475569;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      input[type="text"], input[type="number"], select {
        border-radius: 0.75rem;
        border: 1px solid #cbd5f5;
        padding: 0.75rem 1rem;
        font-size: 1rem;
        min-width: 220px;
      }
      button.primary {
        border: none;
        background: #2563eb;
        color: white;
        padding: 0.85rem 1.5rem;
        border-radius: 0.75rem;
        cursor: pointer;
        font-weight: 600;
        box-shadow: 0 10px 25px rgba(37, 99, 235, 0.35);
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin: 2rem 0;
      }
      .card {
        border-radius: 1rem;
        background: linear-gradient(135deg, #e0ecff, #f8fbff);
        padding: 1.25rem;
      }
      .card .label {
        font-size: 0.85rem;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .card .value {
        font-size: 2rem;
        font-weight: 600;
        margin: 0.25rem 0 0.5rem;
      }
      .card .hint {
        color: #64748b;
        font-size: 0.9rem;
      }
      .section-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      .pill {
        background: #eef2ff;
        padding: 0.35rem 0.9rem;
        border-radius: 999px;
        color: #3730a3;
        font-weight: 600;
        font-size: 0.9rem;
      }
      .table-wrapper {
        overflow-x: auto;
        border-radius: 1rem;
        border: 1px solid #e2e8f0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #e2e8f0;
        text-align: left;
        font-size: 0.95rem;
      }
      th {
        background: #f8fafc;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #475569;
      }
      tr:hover td {
        background: #f1f5f9;
      }
      .actions a {
        text-decoration: none;
        background: #0f172a;
        color: white;
        padding: 0.6rem 1rem;
        border-radius: 0.75rem;
        font-size: 0.9rem;
        margin-left: 0.5rem;
      }
      .actions a.secondary {
        background: #fff;
        color: #0f172a;
        border: 1px solid #cbd5f5;
      }
      .actions__logout {
        text-decoration: none;
        border: 1px solid rgba(255, 255, 255, 0.6);
        color: white;
        padding: 0.5rem 1.25rem;
        border-radius: 999px;
        font-weight: 600;
      }
      footer {
        margin-top: 2rem;
        color: #94a3b8;
        font-size: 0.85rem;
      }
      .muted { color: #94a3b8; }
    </style>
  </head>
  <body>
    <header>
      <p>Signed in as ${username}</p>
      <h1>Grant Manager Portal</h1>
      <p>Explore wrangled grants and scoring snapshots without touching the command line.</p>
    </header>
    <main>
      <section class="controls">
        <div class="section-title">
          <div>
            <h2>Dataset Controls</h2>
            <p class="muted">Source: ${sourceLabel}</p>
            ${profileHtml}
          </div>
          <a class="actions__logout" href="/logout">Logout</a>
        </div>
        <form method="get" action="/dashboard">
          <label>Dataset
            <select name="dataset" disabled>
              <option>${datasetLabel}</option>
            </select>
          </label>
          <label>Search keywords
            <input type="text" name="q" placeholder="Industry, sponsor, notes" value="${query}" />
          </label>
          <label>Rows to preview
            <input type="number" name="limit" min="5" max="100" value="${limit}" />
          </label>
          <button class="primary" type="submit">Update view</button>
        </form>
      </section>
      <section class="cards">
        <div class="card">
          <div class="label">Visible rows</div>
          <div class="value">${totalRows.toLocaleString()}</div>
          <div class="hint">After filters are applied</div>
        </div>
        <div class="card">
          <div class="label">Total funding</div>
          <div class="value">${formatCurrency(summary.totalFunding)}</div>
          <div class="hint">Sum of funding-like columns</div>
        </div>
        <div class="card">
          <div class="label">Next deadline</div>
          <div class="value">${summary.nextDeadline || "Not available"}</div>
          <div class="hint">Earliest future date detected</div>
        </div>
      </section>
      <section>
        <div class="section-title">
          <div>
            <h2>${rowsLabel} (${previewRows.length} of ${totalRows})</h2>
            <p class="muted">Download the CSV to run custom scoring or reviews.</p>
          </div>
          <div class="actions">
            <a href="/data">Download CSV</a>
            <a class="secondary" href="/schema" target="_blank">View Schema</a>
            <a class="secondary" href="/test-endpoints">API checks</a>
          </div>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr>${headerRow}</tr></thead>
            <tbody>
              ${bodyRows || `<tr><td colspan="${Math.max(
                headers.length,
                1
              )}">No data available.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <footer>
        <p class="muted">Need help? Run <code>npm run dev</code> for the worker or use the Python wrangler helpers locally.</p>
      </footer>
    </main>
  </body>
</html>`;
}
