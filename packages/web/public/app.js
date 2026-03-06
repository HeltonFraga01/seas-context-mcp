async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}
async function refreshSidePanels() {
  document.getElementById('health').textContent = JSON.stringify(await fetchJson('/api/health'), null, 2);
  document.getElementById('map').textContent = JSON.stringify(await fetchJson('/api/map'), null, 2);
}
async function runQuery() {
  const query = document.getElementById('query').value;
  document.getElementById('result').textContent = JSON.stringify(await fetchJson(`/api/query?q=${encodeURIComponent(query)}`), null, 2);
}
document.getElementById('run').addEventListener('click', runQuery);
document.getElementById('ingest').addEventListener('click', async () => {
  document.getElementById('result').textContent = JSON.stringify(await fetchJson('/api/ingest', { method: 'POST' }), null, 2);
  await refreshSidePanels();
});
refreshSidePanels();
runQuery();
