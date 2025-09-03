document.getElementById('go').addEventListener('click', async () => {
  const value = Number(document.getElementById('value').value);
  const res = await fetch('/api/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
  const text = await res.text();
  document.getElementById('result').textContent = text;
});
