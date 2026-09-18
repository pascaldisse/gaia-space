/** crm-nav-probe.mjs — what does the CRM rail entry actually point at on the live build? */
import { mkdirSync, writeFileSync } from 'node:fs';
const PORT = Number(process.env.CDP_PORT ?? 9383);
const OUT = new URL('.', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const PASSWORD = process.env.SPACE_ADMIN_PASSWORD; if (!PASSWORD) process.exit(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const newTarget = async (url='about:blank') => (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`,{method:'PUT'})).json();
async function connect(id0){ const ws=new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${id0}`); await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0; const p=new Map(); const ls=[]; ws.onmessage=ev=>{const m=JSON.parse(ev.data); if(m.id&&p.has(m.id)){const{res,rej}=p.get(m.id);p.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);} else if(m.method) ls.forEach(f=>f(m));};
  const send=(method,params={})=>new Promise((res,rej)=>{const i=++id;p.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}));setTimeout(()=>{if(p.has(i)){p.delete(i);rej(new Error('timeout '+method));}},30000);});
  return { send, on:f=>ls.push(f), close:()=>ws.close() }; }
const evalJs = async (c,e) => { const r = await c.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const shot = async (c,p) => { const r = await c.send('Page.captureScreenshot',{format:'png'}); await Bun.write(p, Buffer.from(r.data,'base64')); };
const page = await newTarget('about:blank'); const c = await connect(page.id);
await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable');
await c.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await c.send('Page.navigate',{url:'https://paloptic.com/space/'}); await wait(7000);
if (await evalJs(c,`!!document.querySelector('input[type=password]')`)) {
  await evalJs(c,`(() => { const u=document.querySelector('input:not([type=password])'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,'admin'); u.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await c.send('Runtime.evaluate',{expression:`(() => { const p=document.querySelector('input[type=password]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(p, ${JSON.stringify(PASSWORD)}); p.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`,returnByValue:true});
  await evalJs(c,`(() => { document.querySelector('form')?.requestSubmit(); return true; })()`); await wait(9000);
}
const rail = await evalJs(c, `[...document.querySelectorAll('.rail-item')].map(e => ({ txt: (e.innerText||'').trim().slice(0,20), href: e.getAttribute('href'), cls: String(e.className) }))`);
const clicked = await evalJs(c, `(() => { const el=[...document.querySelectorAll('.rail-item')].find(e=>/CRM/i.test(e.innerText||'')); if(!el) return null; el.click(); return { href: el.getAttribute('href'), after: location.href }; })()`);
await wait(6000);
const state1 = await evalJs(c, `({ url: location.href, crmNodes: document.querySelectorAll('[class*=crm]').length, sidebar: [...document.querySelectorAll('.sidebar, [class*=side]')].map(e=>(e.innerText||'').trim().slice(0,160))[0] ?? null, head: (document.body.innerText||'').trim().slice(0,200) })`);
await shot(c, `${OUT}/08-rail-clicked.png`);
// try the hash/pushState route the router documents: /space/crm/leads
const pushed = await evalJs(c, `(() => { history.pushState({}, '', '/space/crm/leads'); dispatchEvent(new PopStateEvent('popstate')); return location.href; })()`);
await wait(6000);
const state2 = await evalJs(c, `({ url: location.href, crmNodes: document.querySelectorAll('[class*=crm]').length, hasGerman: /Leads|Pipeline|Gewonnen|Papierkorb|Einblicke/.test(document.body.innerText||''), head: (document.body.innerText||'').trim().slice(0,240) })`);
await shot(c, `${OUT}/09-crm-pushstate.png`);
writeFileSync(`${OUT}/report-nav.json`, JSON.stringify({ rail, clicked, state1, pushed, state2 }, null, 2));
console.log(JSON.stringify({ rail, clicked, state1, pushed, state2 }, null, 1));
process.exit(0);
