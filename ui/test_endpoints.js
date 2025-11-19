const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function renderTestEndpointsPage(username = "") {
  const cookieValue = escapeHtml(encodeURIComponent(username));
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Worker Endpoint Explorer</title>
    <style>
      :root {
        font-family: "Inter", system-ui, sans-serif;
        background: #0f1221;
        color: #f4f6ff;
      }
      body {
        margin: 0;
        padding: 2rem;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 2rem;
      }
      a {
        color: #8db8ff;
      }
      .card {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      button {
        border: none;
        border-radius: 999px;
        padding: 0.65rem 1.25rem;
        background: linear-gradient(120deg, #6b8dff, #7e59ff);
        color: #fff;
        font-weight: 600;
        cursor: pointer;
      }
      pre {
        background: #050713;
        border-radius: 12px;
        padding: 1rem;
        overflow: auto;
        font-size: 0.85rem;
      }
      code {
        background: rgba(255, 255, 255, 0.08);
        padding: 0.2rem 0.4rem;
        border-radius: 6px;
      }
      ul {
        margin: 0;
        padding-left: 1.25rem;
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>Worker Endpoint Explorer</h1>
        <p>You are signed in as <strong>${escapeHtml(username)}</strong>.</p>
      </div>
      <p><a href="/dashboard">← Back to Dashboard</a></p>
    </header>
    <section class="card">
      <h2>Test /api/grants</h2>
      <p>Call the JSON endpoint directly to view the scored payload.</p>
      <button id="loadGrants">Fetch grants</button>
      <p id="status" aria-live="polite"></p>
      <pre id="output">Waiting for response…</pre>
    </section>
    <section class="card">
      <h2>Quick commands</h2>
      <p>Use these snippets during development to exercise the worker locally.</p>
      <ul>
        <li><code>curl -b "session=${cookieValue}" http://localhost:8787/api/grants</code></li>
        <li><code>curl http://localhost:8787/schema</code></li>
        <li><code>curl http://localhost:8787/data</code></li>
      </ul>
    </section>
    <script>
      const loadBtn = document.getElementById('loadGrants');
      const output = document.getElementById('output');
      const status = document.getElementById('status');
      loadBtn.addEventListener('click', async () => {
        try {
          loadBtn.disabled = true;
          status.textContent = 'Loading…';
          output.textContent = '';
          const response = await fetch('/api/grants');
          const text = await response.text();
          try {
            const data = JSON.parse(text);
            status.textContent = `Received ${data.length} items.`;
            output.textContent = JSON.stringify(data.slice(0, 10), null, 2);
          } catch (err) {
            status.textContent = 'Received a non-JSON response';
            output.textContent = text;
          }
        } catch (err) {
          status.textContent = 'Request failed.';
          output.textContent = err.message;
        } finally {
          loadBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>`;
}
