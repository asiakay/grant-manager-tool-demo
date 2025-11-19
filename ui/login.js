export function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Grant Wrangler Login</title>
    <style>
      :root {
        font-family: "Inter", system-ui, sans-serif;
        background: radial-gradient(circle at top, #161d45, #050713 65%);
        color: #f6f6ff;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 2rem;
      }
      .card {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 2.5rem;
        width: min(420px, 100%);
        backdrop-filter: blur(8px);
      }
      h1 {
        margin-top: 0;
        font-size: 1.75rem;
      }
      label {
        display: block;
        margin-bottom: 1rem;
        font-weight: 500;
      }
      input {
        width: 100%;
        padding: 0.85rem 1rem;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(0, 0, 0, 0.2);
        color: #fff;
        font-size: 1rem;
      }
      button {
        width: 100%;
        border: none;
        border-radius: 999px;
        padding: 0.9rem 1rem;
        font-size: 1rem;
        font-weight: 600;
        background: linear-gradient(120deg, #6b8dff, #7e59ff);
        color: #fff;
        cursor: pointer;
        margin-top: 0.5rem;
      }
      p {
        color: rgba(255, 255, 255, 0.75);
        line-height: 1.5;
      }
      code {
        background: rgba(255, 255, 255, 0.1);
        padding: 0.15rem 0.35rem;
        border-radius: 6px;
      }
      small {
        display: block;
        margin-top: 1rem;
        font-size: 0.85rem;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Grant Wrangler Demo</h1>
      <p>
        Sign in to access the dashboard. The hosted worker checks your credentials
        against the <code>USER_HASHES</code> binding.
      </p>
      <p>Use <code>demo/demo</code> locally.</p>
      <form method="POST" action="/login">
        <label>Username <input name="username" autocomplete="username" required /></label>
        <label>Password <input type="password" name="password" autocomplete="current-password" required /></label>
        <button type="submit">Sign in</button>
      </form>
      <small>Need access? Update <code>USER_HASHES</code> in <code>wrangler.toml</code> or pass it via <code>wrangler secret put</code>.</small>
    </main>
  </body>
</html>`;
}
