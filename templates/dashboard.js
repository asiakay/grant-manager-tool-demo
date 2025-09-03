export function renderDashboardPage(headers = [], rows = []) {
  const headerRow = headers.map((h) => `<th>${h}</th>`).join("");
  const bodyRows = rows
    .map((cols) => `<tr>${cols.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Dashboard</title></head>
<body>
  <h1>Program Data Schema</h1>
  <table border="1">
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <p>
    <a href="/schema">View schema JSON</a> |
    <a href="/data">Sample CSV</a> |
    <a href="/logout">Logout</a>
  </p>
</body>
</html>`;
}
