import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const config = await Bun.file("bridge/room-link/config.json").json();
const base = config.space.baseUrl.replace(/\/$/, "");
const adminToken = config.space.personalAccessToken;
if (!adminToken) throw new Error("space.personalAccessToken is required");
const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const output = `proof/cw-call-2peer-${stamp}`;
const createdUsers = [];
const result = { utc: new Date().toISOString(), base, output, health: {}, pixels: {}, room: {}, secondClick: {}, elsewhere: {}, errors: [] };
const request = async (url, options = {}) => {
  const response = await fetch(`${base}${url}`, options);
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
};
const need = (label, response) => {
  if (response.status !== 200 || response.body?.ok === false) throw new Error(`${label}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  return response.body?.value ?? response.body;
};
const cmd = (cookie, name, body) => request(`/api/cmd/${name}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
const cleanup = async () => {
  const deletions = [];
  for (const { id, username } of createdUsers) {
    let response;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      response = await request(`/api/users/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${adminToken}` } });
      if (response.status === 200 || response.status === 404) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
    deletions.push({ username, status: response.status });
  }
  const listed = await request("/api/users", { headers: { authorization: `Bearer ${adminToken}` } });
  const users = Array.isArray(listed.body) ? listed.body : listed.body?.value ?? [];
  const remnants = users.filter(user => createdUsers.some(created => created.username === user.username)).map(user => user.username);
  result.cleanup = { deletions, verify: { status: listed.status, remnants } };
  if (listed.status !== 200 || remnants.length) throw new Error(`proof-account purge verification failed: ${JSON.stringify(result.cleanup)}`);
};
const makePeer = async (side) => {
  const username = `zz-proof-${side}-${suffix}`;
  const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  let created;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    created = await request("/api/users", { method: "POST", headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" }, body: JSON.stringify({ username, password, display_name: `zz-proof-${side.toUpperCase()}`, role: "GlobalMember", profile_id: null }) });
    if (created.status !== 500 || !String(created.body?.error ?? "").includes("database is locked")) break;
    await new Promise(resolve => setTimeout(resolve, attempt * 500));
  }
  const user = need(`create ${side}`, created);
  createdUsers.push(user);
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!login.ok || !cookie) throw new Error(`login ${side}: HTTP ${login.status}`);
  const me = need(`me ${side}`, await request("/api/auth/me", { headers: { cookie } }));
  return { ...user, cookie, profileId: me.user.profile_id };
};
const installProbe = () => {
  window.__proofCalls = [];
  const original = window.fetch;
  window.fetch = async (...args) => {
    const url = String(args[0] instanceof Request ? args[0].url : args[0]);
    const response = await original(...args);
    if (url.includes("/api/cmd/create_channel_call") || url.includes("/api/cmd/join_meeting_call")) {
      let body = null;
      try {
        const json = await response.clone().json();
        body = { ok: json?.ok, value: { id: json?.value?.id ?? null, room: json?.value?.room ?? null } };
      } catch {}
      window.__proofCalls.push({ url, status: response.status, body });
    }
    return response;
  };
};
let browser; let contexts = []; let pages = {};
try {
  for (let i = 0; i < 5; i += 1) {
    const read = await request("/api/users", { headers: { authorization: `Bearer ${adminToken}` } });
    result.health[`users_${i + 1}`] = read.status;
    if (read.status !== 200) throw new Error(`health /api/users ${i + 1}: HTTP ${read.status} ${JSON.stringify(read.body)}`);
  }
  const a = await makePeer("a"); const b = await makePeer("b");
  const directChannelId = `zz-proof-http-${suffix}`;
  need("create direct-proof DM", await cmd(a.cookie, "create_channel", { channel: { id: directChannelId, content_type: "dm", name: null, description: null, project_id: null, archived: false }, memberIds: [a.profileId, b.profileId] }));
  const direct = await cmd(a.cookie, "create_channel_call", { meeting: { id: `zz-proof-http-meeting-${suffix}`, title: "Direct API proof", description: null, starts_at: Math.floor(Date.now() / 1_000), ends_at: Math.floor(Date.now() / 1_000) + 300, rrule: null, location: null, organizer_id: b.profileId, channel_id: directChannelId, visibility: "participants", modification_preference: "organizer-only", archived: false, video_provider: "livekit", video_status: "scheduled" } });
  result.direct = { status: direct.status, body: direct.body };
  need("direct create_channel_call", direct);
  result.direct.archive = { status: (await cmd(a.cookie, "archive_meeting", { id: `zz-proof-http-meeting-${suffix}`, archived: true })).status };
  if (result.direct.archive.status !== 200) throw new Error(`archive direct-proof call: HTTP ${result.direct.archive.status}`);
  const channelId = `zz-proof-channel-${suffix}`;
  const channel = need("create zz-proof channel", await cmd(a.cookie, "create_channel", { channel: { id: channelId, content_type: "dm", name: null, description: null, project_id: null, archived: false }, memberIds: [a.profileId, b.profileId] }));
  result.channel = { id: channel.id, members: [a.profileId, b.profileId] };
  browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  contexts = await Promise.all([a, b].map(async peer => {
    const context = await browser.newContext();
    await context.grantPermissions(["camera", "microphone"], { origin: new URL(base).origin });
    await context.addCookies([{ name: peer.cookie.split("=")[0], value: peer.cookie.slice(peer.cookie.indexOf("=") + 1), domain: new URL(base).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
    return context;
  }));
  const [pageA, pageB] = await Promise.all(contexts.map(context => context.newPage())); pages = { a: pageA, b: pageB };
  await Promise.all([pageA.addInitScript(installProbe), pageB.addInitScript(installProbe)]);
  const route = `${base}/channel/${channel.id}/messages`;
  await Promise.all([pageA.goto(route, { waitUntil: "networkidle" }), pageB.goto(`${base}/`, { waitUntil: "networkidle" })]);
  result.elsewhere.before = { url: pageB.url(), incoming: await pageB.locator(".incoming-call-ring").count() };
  await pageA.getByRole("button", { name: "Video", exact: true }).click();
  await pageA.locator('[data-call-state="connected"]').waitFor({ timeout: 45_000 });
  await pageA.screenshot({ path: `${output}-a-started.png`, fullPage: true });
  const ring = pageB.locator(".incoming-call-ring");
  await ring.waitFor({ state: "visible", timeout: 20_000 });
  result.elsewhere.after = { url: pageB.url(), banner: (await ring.textContent())?.trim() };
  await pageB.screenshot({ path: `${output}-b-elsewhere.png`, fullPage: true });
  await pageB.goto(route, { waitUntil: "networkidle" });
  const join = pageB.locator(".chat-live-call button");
  await join.waitFor({ state: "visible", timeout: 20_000 });
  result.pixels.banner = (await pageB.locator(".chat-live-call").textContent())?.trim() ?? "";
  await pageB.screenshot({ path: `${output}-b-banner.png`, fullPage: true });
  await join.click();
  await Promise.all([pageA.locator('[data-call-state="connected"]').waitFor({ timeout: 45_000 }), pageB.locator('[data-call-state="connected"]').waitFor({ timeout: 45_000 })]);
  await Promise.all([pageA.getByText("Connected · 2", { exact: true }).waitFor({ timeout: 20_000 }), pageB.getByText("Connected · 2", { exact: true }).waitFor({ timeout: 20_000 })]);
  const state = async page => ({ state: await page.locator('[data-call-state="connected"]').first().textContent(), tiles: await page.locator(".call-tile").count() });
  result.room.a = { ...await state(pageA), join: await pageA.evaluate(() => window.__proofCalls.filter(call => call.url.includes("/api/cmd/join_meeting_call")).at(-1)) };
  result.room.b = { ...await state(pageB), join: await pageB.evaluate(() => window.__proofCalls.filter(call => call.url.includes("/api/cmd/join_meeting_call")).at(-1)) };
  const roomOf = entry => entry?.body?.value?.room ?? entry?.body?.room ?? null;
  result.room.same = roomOf(result.room.a.join) !== null && roomOf(result.room.a.join) === roomOf(result.room.b.join);
  result.pixels.connected = result.room.a.state?.startsWith("Connected") && result.room.b.state?.startsWith("Connected") && result.room.a.tiles >= 2 && result.room.b.tiles >= 2 && result.room.same;
  await pageB.screenshot({ path: `${output}-b-joined.png`, fullPage: true });
  await pageA.screenshot({ path: `${output}-a-sees-b.png`, fullPage: true });
  const beforeCalls = await pageB.evaluate(() => window.__proofCalls.filter(call => call.url.includes("/api/cmd/create_channel_call")));
  const firstCall = await pageA.evaluate(() => window.__proofCalls.filter(call => call.url.includes("/api/cmd/create_channel_call")).at(-1));
  await pageB.getByRole("button", { name: "Video", exact: true }).click();
  await pageB.waitForTimeout(1_000);
  const afterCalls = await pageB.evaluate(() => window.__proofCalls.filter(call => call.url.includes("/api/cmd/create_channel_call")));
  const returned = afterCalls.at(-1);
  const firstId = firstCall?.body?.value?.id ?? null;
  const returnedId = returned?.body?.value?.id ?? null;
  result.secondClick = { requests: afterCalls.length - beforeCalls.length, firstId, returnedId, minted: returnedId && returnedId !== firstId ? 1 : 0, roomAfter: await state(pageB) };
  await pageB.screenshot({ path: `${output}-b-video-same-room.png`, fullPage: true });
} catch (error) {
  result.errors.push(String(error));
  await Promise.all(Object.entries(pages).map(async ([side, page]) => page.screenshot({ path: `${output}-${side}-failure.png`, fullPage: true }).catch(() => undefined)));
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
  await browser?.close();
  await cleanup().catch(error => result.errors.push(`cleanup: ${error}`));
  await writeFile(`${output}.txt`, `${Object.entries(result).map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n")}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
