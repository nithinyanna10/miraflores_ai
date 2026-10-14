// After any test run against a deployed URL, put the demo back in the mid-season scenario.
export async function resetIfLive(base: string) {
  const u = new URL(base);
  if (['localhost', '127.0.0.1'].includes(u.hostname)) return;
  const s = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person: 'st-05' }) });
  const cookie = s.headers.get('set-cookie')?.split(';')[0] ?? '';
  const r = await fetch(`${base}/api/admin/reset`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ scenario: 'midseason' }) });
  console.log(r.ok ? `reset ${u.hostname} to the mid-season scenario` : `FAILED to reset ${u.hostname}: ${r.status}`);
}
