export function renderProfilePage(message = "") {
  const status = message ? `<p><strong>${message}</strong></p>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>User Profile</title></head>
<body>
  <h1>User Profile</h1>
  ${status}
  <form method="POST" action="/profile">
    <label>Input Folder <input name="input" /></label><br />
    <label>Output CSV <input name="out" value="out/clean.csv" /></label><br />
    <button type="submit">Clean Data</button>
  </form>
  <p><a href="/logout">Logout</a></p>
</body>
</html>`;
}
