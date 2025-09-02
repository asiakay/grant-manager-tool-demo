const users = {
  admin: 'adminpass',
  user: 'userpass'
};

const grants = [
  { title: 'Community Garden', amount: 5000, start: '2024-01-01', end: '2024-06-30' },
  { title: 'STEM Program', amount: 12000, start: '2024-03-15', end: '2024-12-31' },
  { title: 'Art Outreach', amount: 8000, start: '2024-07-01', end: '2025-01-31' }
];

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
}

function dashboardPage() {
  const rows = grants
    .map(g => `<tr><td>${g.title}</td><td>${g.amount}</td><td>${g.start}</td><td>${g.end}</td></tr>`)
    .join('');
  const chartData = {
    labels: grants.map(g => g.title),
    data: grants.map(g => g.amount)
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Grant Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <h1>Grant Dashboard</h1>
  <a href="/logout">Logout</a>
  <h2>Grant Timeline</h2>
  <table border="1">
    <tr><th>Project</th><th>Amount</th><th>Start</th><th>End</th></tr>
    ${rows}
  </table>
  <h2>Funding Visualization</h2>
  <canvas id="fundingChart"></canvas>
  <script>
    const ctx = document.getElementById('fundingChart').getContext('2d');
    const data = ${JSON.stringify(chartData)};
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{
          label: 'Amount',
          data: data.data,
          backgroundColor: 'rgba(54, 162, 235, 0.5)'
        }]
      },
      options: { scales: { y: { beginAtZero: true } } }
    });
  </script>
</body>
</html>`;
}

export default {
  async fetch(request) {
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
          headers: { 'Set-Cookie': 'session=active; Path=/', Location: '/dashboard' }
        });
      }
      return new Response('Unauthorized', { status: 401 });
    }

    if (url.pathname === '/dashboard') {
      if (!loggedIn) {
        return new Response('', { status: 302, headers: { Location: '/' } });
      }
      return new Response(dashboardPage(), {
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

