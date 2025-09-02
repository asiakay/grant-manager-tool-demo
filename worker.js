export default {
  async fetch(request, env, ctx) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Grant Wrangler Demo</title></head>
<body>
<h1>Grant Wrangler Demo</h1>
<p>The Cloudflare Worker is running. Use this endpoint as a placeholder.</p>
</body>
</html>`;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=UTF-8' }});
  }
}
