/**
 * live-crm-proof.mjs — PR #31 (CRM sales workspace) on https://paloptic.com/space/
 *   SPACE_ADMIN_PASSWORD=... CDP_PORT=9383 bun proof/crm-live-0918/live-crm-proof.mjs
 * Read-only: logs in as admin, renders pages, never writes a record.
 * Password comes from the environment and is never printed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9383);
const OUT = new URL('.', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PASSWORD = process.env.SPACE_ADMIN_PASSWORD;
if (!PASSWORD) { console.error('SPACE_ADMIN_PASSWORD missing'); process.exit(2); }

const wait = ms => new Promise(r => setTimeout(r, ms));
const newTarget = async (url = 'about:blank') =>
  (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();

async function connect(targetId) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${targetId}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method) listeners.forEach(f => f(m)); };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 30000); });
  return { send, on: f => listeners.push(f), close: () => ws.close() };
}
const evalJs = async (c, expr) => {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (c, path) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); await Bun.write(path, Buffer.from(r.data, 'base64')); };

const page = await newTarget('about:blank');
const c = await connect(page.id);
const errs = {}; let label = 'boot';
const push = (k, t) => { (errs[label] ??= []).push(`${k}: ${String(t).slice(0, 200)}`); };
c.on(m => {
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') push('consoleAPI', m.params.args.map(a => a.description ?? a.value ?? '').join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') push('Log', m.params.entry.text + ' ' + (m.params.entry.url ?? ''));
  if (m.method === 'Runtime.exceptionThrown') push('exception', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

const SET = `(sel, value) => { const el = document.querySelector(sel); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); return true; }`;

const report = { probedAt: new Date().toISOString(), steps: [] };

label = 'login';
await c.send('Page.navigate', { url: 'https://paloptic.com/space/' });
await wait(6000);
const pre = await evalJs(c, `(() => ({ url: location.href, inputs: [...document.querySelectorAll('input')].map(i => ({ type: i.type, name: i.name, label: i.getAttribute('aria-label'), ph: i.placeholder })), buttons: [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).slice(0,8), head: (document.body.innerText||'').trim().slice(0,160) }))()`);
await shot(c, `${OUT}/01-gate.png`);
report.steps.push({ step: 'pre-login', state: pre, errors: errs[label] ?? [] });

if (pre.inputs.some(i => i.type === 'password')) {
  const userSel = 'input:not([type=password])';
  await evalJs(c, `(${SET})('${userSel}', 'admin')`);
  await c.send('Runtime.evaluate', { expression: `(() => { const el = document.querySelector('input[type=password]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(el, ${JSON.stringify(PASSWORD)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`, returnByValue: true });
  await evalJs(c, `(() => { const f = document.querySelector('form'); if (f) { f.requestSubmit ? f.requestSubmit() : f.submit(); return 'form'; }
    const b = [...document.querySelectorAll('button')].find(b => /log ?in|sign ?in|anmelden/i.test(b.innerText||'')); b?.click(); return 'button'; })()`);
  await wait(9000);
}
const post = await evalJs(c, `(() => ({ url: location.href, head: (document.body.innerText||'').trim().slice(0,200), nav: [...document.querySelectorAll('a[href],[role=tab],.nav-item')].map(e => (e.innerText||'').trim()).filter(Boolean).slice(0,30) }))()`);
await shot(c, `${OUT}/02-after-login.png`);
report.steps.push({ step: 'post-login', state: post, errors: errs[label] ?? [] });

label = 'crm';
await c.send('Page.navigate', { url: 'https://paloptic.com/space/crm' });
await wait(8000);
const crm = await evalJs(c, `(() => {
  const t = (document.body.innerText||'').trim();
  return { url: location.href, title: document.title,
    crmRoot: !!document.querySelector('[class*=crm]'),
    crmNodes: document.querySelectorAll('[class*=crm]').length,
    tabs: [...document.querySelectorAll('[role=tab],.crm-tab,nav a')].map(e => (e.innerText||'').trim()).filter(Boolean).slice(0,20),
    hasGerman: /Leads|Pipeline|Gewonnen|Verloren|Papierkorb|Einblicke/.test(t),
    head: t.slice(0, 260) };
})()`);
await shot(c, `${OUT}/03-crm.png`);
report.steps.push({ step: 'crm', state: crm, errors: errs[label] ?? [] });

label = 'crm-insights';
await c.send('Page.navigate', { url: 'https://paloptic.com/space/crm/insights' });
await wait(7000);
const insights = await evalJs(c, `(() => ({ url: location.href, charts: document.querySelectorAll('svg,canvas').length, head: (document.body.innerText||'').trim().slice(0,200) }))()`);
await shot(c, `${OUT}/04-crm-insights.png`);
report.steps.push({ step: 'crm-insights', state: insights, errors: errs[label] ?? [] });

for (const [name, path] of [['home', 'home'], ['documents', 'documents'], ['issues', 'issues']]) {
  label = 'page-' + name;
  await c.send('Page.navigate', { url: `https://paloptic.com/space/${path}` });
  await wait(7000);
  const st = await evalJs(c, `(() => ({ url: location.href, bodyLen: (document.body.innerText||'').trim().length, head: (document.body.innerText||'').trim().slice(0,120) }))()`);
  await shot(c, `${OUT}/05-${name}.png`);
  report.steps.push({ step: label, state: st, errors: errs[label] ?? [] });
}

report.errorsByStep = errs;
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.steps.map(s => ({ step: s.step, url: s.state.url, key: s.state.hasGerman ?? s.state.crmNodes ?? s.state.bodyLen ?? s.state.head?.slice(0, 60), errors: s.errors })), null, 1));
process.exit(0);
