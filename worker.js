const users = {
  admin: 'adminpass',
  user: 'userpass'
};

}

function loginPage() {
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
  
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cookie = request.headers.get('Cookie') || '';
    const loggedIn = cookie.includes('session=active');


    if (url.pathname === '/login' && request.method === 'POST') {
      const form = await request.formData();
      const user = form.get('username');
      const pass = form.get('password');
      if (users[user] === pass) {
        return new Response('', {
          status: 302,

        });
      }
      return new Response('Unauthorized', { status: 401 });
    }

    if (url.pathname === '/dashboard') {
      if (!loggedIn) {
        return new Response('', { status: 302, headers: { Location: '/' } });
      }

        headers: { 'content-type': 'text/html; charset=UTF-8' }
      });
    }

    if (url.pathname === '/logout') {
      return new Response('', {
        status: 302,
        headers: {
          'Set-Cookie': 'session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          Location: '/'
        }
      });
    }

    return new Response(loginPage(), {
      headers: { 'content-type': 'text/html; charset=UTF-8' }
    });
  }
};

