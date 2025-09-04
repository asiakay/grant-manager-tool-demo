export function renderTestEndpointsPage(username = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Test Endpoints</title></head>
<body>
  <h1>Endpoint Tester</h1>
  <p>Logged in as <strong>${username}</strong></p>
  <button id="loadGrants">Load Grants</button>
  <pre id="output"></pre>
  <p><a href="/dashboard">Back to dashboard</a></p>
  <script>
    document.getElementById('loadGrants').addEventListener('click', async () => {
      const res = await fetch('/api/grants');
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        document.getElementById('output').textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        document.getElementById('output').textContent = text;
      }
    });
  </script>
</body>
</html>`;
}
