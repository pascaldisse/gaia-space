/** live-crm-click.mjs — reach the CRM the way a user does: log in, click the rail entry. */
import { mkdirSync, writeFileSync } from 'node:fs';
const PORT = Number(process.env.CDP_PORT ?? 9383);
const OUT = new URL('.', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PASSWORD = process.env.SPACE_ADMIN_PASSWORD;
if (!PASSWORD) { console.error('SPACE_ADMIN_PASSWORD missing'); process.exit(2); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const newTarget = async (url = 'about:blank') => (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
async function connect(targetId) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${targetId}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method) listeners.forEach(f => f(m)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 30000); });
  return { send, on: f => listeners.push(f), close: () => ws.close() };
}
const evalJs = async (c, e) => { const r = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const shot = async (c, p) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); await Bun.write(p, Buffer.from(r.data, 'base64')); };
async function realClick(c, x, y) {
  const hit = await evalJs(c, `(() => { const e = document.elementFromPoint(${x}, ${y}); return e ? { tag: e.tagName, cls: String(e.className).slice(0,60), txt: (e.innerText||'').trim().slice(0,40) } : null; })()`);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await wait(40);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  return hit;
}
const page = await newTarget('about:blank');
const c = await connect(page.id);
const errs = {}; let label = 'login';
const push = (k, t) => { (errs[label] ??= []).push(`${k}: ${String(t).slice(0, 200)}`); };
c.on(m => {
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') push('consoleAPI', m.params.args.map(a => a.description ?? a.value ?? '').join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') push('Log', m.params.entry.text + ' ' + (m.params.entry.url ?? ''));
  if (m.method === 'Runtime.exceptionThrown') push('exception', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await c.send('Page.navigate', { url: 'https://paloptic.com/space/' });
await wait(7000);
if (await evalJs(c, `!!document.querySelector('input[type=password]')`)) {
  await evalJs(c, `(() => { const u = document.querySelector('input:not([type=password])'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(u,'admin'); u.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await c.send('Runtime.evaluate', { expression: `(() => { const p = document.querySelector('input[type=password]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(p, ${JSON.stringify(PASSWORD)}); p.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`, returnByValue: true });
  await evalJs(c, `(() => { const f = document.querySelector('form'); f?.requestSubmit(); return !!f; })()`);
  await wait(9000);
}
const report = { probedAt: new Date().toISOString(), steps: [] };
label = 'crm-click';
const target = await evalJs(c, `(() => { const el = [...document.querySelectorAll('button,a,[role=button],[class*=nav]')].find(e => /^CRM$/i.test((e.innerText||'').trim()) && e.getBoundingClientRect().width > 2);
  if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), tag: el.tagName, cls: String(el.className).slice(0,50) }; })()`);
if (!target) { console.error('no CRM rail entry'); process.exit(3); }
const hit = await realClick(c, target.x, target.y);
await wait(8000);
const crm = await evalJs(c, `(() => { const t = (document.body.innerText||'').trim();
  return { url: location.href, crmNodes: document.querySelectorAll('[class*=crm]').length,
    tabs: [...document.querySelectorAll('[class*=crm] [role=tab], [class*=crm] button')].map(e => (e.innerText||'').trim()).filter(Boolean).slice(0,16),
    hasGerman: /Leads|Pipeline|Gewonnen|Verloren|Papierkorb|Einblicke/.test(t), head: t.slice(0, 300) }; })()`);
await shot(c, `${OUT}/06-crm-clicked.png`);
report.steps.push({ step: 'crm-click', target, hit, state: crm, errors: errs[label] ?? [] });
// a CRM sub-tab, clicked in-app
label = 'crm-tab';
const tabHit = await evalJs(c, `(() => { const el = [...document.querySelectorAll('button,a,[role=tab]')].find(e => /Einblicke|Insights/i.test((e.innerText||'').trim()) && e.getBoundingClientRect().width > 2);
  if (!el) return null; el.click(); return (el.innerText||'').trim(); })()`);
await wait(6000);
const tab = await evalJs(c, `(() => ({ url: location.href, charts: document.querySelectorAll('svg,canvas').length, head: (document.body.innerText||'').trim().slice(0,240) }))()`);
await shot(c, `${OUT}/07-crm-insights-clicked.png`);
report.steps.push({ step: 'crm-tab', tabHit, state: tab, errors: errs[label] ?? [] });
report.errorsByStep = errs;
writeFileSync(`${OUT}/report-click.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
process.exit(0);
