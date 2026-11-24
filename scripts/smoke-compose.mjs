// Smoke test for the running Docker Compose stack (C5: "1-command local onboarding").
//   docker compose -f deploy/docker-compose.yml up -d --build
//   node scripts/smoke-compose.mjs            # WEB=http://localhost:8080 DRIVER=http://localhost:8081
// Exits non-zero on the first failure. Uses only Node 22+ built-ins (fetch, WebSocket).

const WEB = process.env.WEB ?? 'http://localhost:8080';
const DRIVER = process.env.DRIVER ?? 'http://localhost:8081';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 90_000);

let failures = 0;
const ok = (name, detail = '') => console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`);
const fail = (name, err) => {
  failures++;
  console.log(`  ✗ ${name}: ${err}`);
};
async function check(name, fn) {
  try {
    ok(name, await fn());
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth() {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    try {
      const r = await fetch(`${WEB}/health`);
      if (r.ok) return r.json();
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`stack not healthy after ${TIMEOUT_MS} ms`);
    await sleep(1000);
  }
}

console.log(`smoke: web ${WEB}, driver ${DRIVER}`);
const health = await waitForHealth().catch((e) => {
  fail('health', e.message);
  process.exit(1);
});
ok('API healthy through nginx', `feed ${health.feedVersion}, ${health.routes} routes`);

await check('commuter app shell + manifest', async () => {
  const html = await (await fetch(`${WEB}/`)).text();
  if (!html.includes('<div id="root">')) throw new Error('no app root');
  const m = await (await fetch(`${WEB}/manifest.webmanifest`)).json();
  if (m.display !== 'standalone') throw new Error('manifest not standalone');
  const sw = await fetch(`${WEB}/sw.js`);
  if (!sw.ok) throw new Error('no service worker');
  return 'html, manifest, sw.js';
});

await check('SPA fallback for deep links', async () => {
  const r = await fetch(`${WEB}/some/deep/link?from=28.6,77.2,x`);
  if (!r.ok || !(await r.text()).includes('id="root"')) throw new Error(`status ${r.status}`);
  return '200 → index.html';
});

await check('trip planning through nginx', async () => {
  const r = await fetch(`${WEB}/api/v1/plan?fromLat=28.6675&fromLng=77.2282&toLat=28.6563&toLng=77.2412`);
  const body = await r.json();
  if (!body.itineraries?.length) throw new Error('no itineraries (outside service hours? set DEMO_TIME_OF_DAY)');
  return `${body.itineraries.length} itineraries via ${r.headers.get('x-planner')}`;
});

await check('driver portal + report through its nginx', async () => {
  const html = await (await fetch(`${DRIVER}/?stand=kg-auto-1`)).text();
  if (!html.includes('id="root"')) throw new Error('no app root');
  const r = await fetch(`${DRIVER}/api/v1/telemetry/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ standId: 'kg-auto-1', kind: 'DEPARTING_NOW', reportedAt: new Date().toISOString() }),
  });
  if (r.status !== 202) throw new Error(`status ${r.status}`);
  return '202 accepted';
});

await check('WebSocket live feed through nginx', async () => {
  const ws = new WebSocket(`${WEB.replace(/^http/, 'ws')}/api/v1/live`);
  let n = 0;
  await new Promise((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe.bbox', bbox: [77.2, 28.62, 77.26, 28.68] }));
    ws.onmessage = () => n++;
    ws.onerror = () => reject(new Error('socket error'));
    setTimeout(resolve, 5000);
  });
  ws.close();
  if (n === 0) throw new Error('no messages in 5 s');
  return `${n} messages in 5 s`;
});

await check('API docs', async () => {
  const r = await fetch(`${WEB.replace(':8080', ':3000')}/docs/json`).catch(() => null);
  if (!r) return 'skipped (API port not published)';
  const doc = await r.json();
  return `${Object.keys(doc.paths).length} paths`;
});

console.log(failures ? `smoke: ${failures} FAILED` : 'smoke: all passed');
process.exit(failures ? 1 : 0);
