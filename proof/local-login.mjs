import { chromium } from 'playwright'; import fs from 'fs';
const pw = fs.readFileSync(process.env.HOME+'/.gaia/secrets/space.env','utf8').match(/^SPACE_ADMIN_PASSWORD=(.*)$/m)[1].replace(/^["']|["']$/g,'');
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1280,height:800}});
await p.goto('http://127.0.0.1:8091/space/home',{waitUntil:'networkidle'});
await p.locator('input').nth(0).fill('admin'); await p.locator('input').nth(1).fill(pw); await p.keyboard.press('Enter');
await p.waitForTimeout(3000); await p.screenshot({path:'proof/local-space-loggedin.png'}); console.log(p.url()); await b.close();
