export function renderLoginPage() {
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
