import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1280,height:800}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8091/space/home',{waitUntil:'networkidle'}); await p.waitForTimeout(1500);
await p.screenshot({path:'proof/local-space-home.png'}); console.log(await p.title(), errs.slice(0,3)); await b.close();
