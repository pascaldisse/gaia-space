import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const config = await Bun.file(process.env.SPACE_PROOF_CONFIG ?? "bridge/room-link/config.json").json();
const base = config.space.baseUrl.replace(/\/$/, "");
const adminToken = config.space.personalAccessToken;
if (!adminToken) throw new Error("space.personalAccessToken is required");
const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const output = `proof/cw-call-recipient-${stamp}`;
const request = async (url, options = {}) => {
  const response = await fetch(`${base}${url}`, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${url}: ${response.status} ${JSON.stringify(body)}`);
  return body;
};
const cmd = async (cookie, name, body) => {
  const response = await request(`/api/cmd/${name}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${name}: ${JSON.stringify(response)}`);
  return response.value;
};
const createdUsers = [];
const cleanup = async () => Promise.all(createdUsers.map(async ({ id }) => {
  await fetch(`${base}/api/users/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${adminToken}` } });
}));
let browser;
try {
  const createPeer = async (side) => {
    const username = `zz-proof-cw-${side}-${suffix}`;
    const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const user = await request("/api/users", { method: "POST", headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" }, body: JSON.stringify({ username, password, display_name: `zz-proof-${side}`, role: "member", profile_id: null }) });
    createdUsers.push(user);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!login.ok || !cookie) throw new Error(`login ${side}: ${login.status}`);
    const me = await request("/api/auth/me", { headers: { cookie } });
    return { cookie, profileId: me.user.profile_id, userId: user.id };
  };
  const a = await createPeer("a"); const b = await createPeer("b");
  const channel = await cmd(a.cookie, "create_channel", { channel: { id: `zz-proof-cw-${suffix}`, content_type: "dm", name: null, description: null, project_id: null, archived: false }, memberIds: [a.profileId, b.profileId] });
  browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const contexts = await Promise.all([a, b].map(async ({ cookie }) => {
    const context = await browser.newContext();
    await context.grantPermissions(["camera", "microphone"], { origin: new URL(base).origin });
    await context.addCookies([{ name: cookie.split("=")[0], value: cookie.slice(cookie.indexOf("=") + 1), domain: new URL(base).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
    return context;
  }));
  const [pageA, pageB] = await Promise.all(contexts.map((context) => context.newPage()));
  const route = `${base}/channel/${channel.id}/messages`;
  await Promise.all([pageA.goto(route, { waitUntil: "networkidle" }), pageB.goto(route, { waitUntil: "networkidle" })]);
  await pageA.getByRole("button", { name: "Video", exact: true }).click();
  await pageA.locator('[data-call-state="connected"]').waitFor({ timeout: 45_000 });
  await pageA.screenshot({ path: `${output}-a-start.png`, fullPage: true });
  const banner = pageB.locator(".cw-live-call");
  await banner.waitFor({ state: "visible", timeout: 20_000 });
  const bannerText = await banner.textContent();
  await pageB.screenshot({ path: `${output}-b-banner.png`, fullPage: true });
  await banner.getByRole("button", { name: "Join", exact: true }).click();
  await Promise.all([pageA.locator('[data-call-state="connected"]').waitFor({ timeout: 45_000 }), pageB.locator('[data-call-state="connected"]').waitFor({ timeout: 45_000 })]);
  await pageB.screenshot({ path: `${output}-b-joined.png`, fullPage: true });
  await pageA.screenshot({ path: `${output}-a-joined.png`, fullPage: true });
  await writeFile(`${output}.txt`, [`utc=${new Date().toISOString()}`, `base=${base}`, `channel.id=${channel.id}`, `channel.members=${a.profileId},${b.profileId}`, `route=${route}`, `banner=${bannerText?.trim()}`, "pixels.banner=yes", "both.connected=yes", `accounts=${a.userId},${b.userId}`, "cleanup=users deleted"].join("\n") + "\n");
  console.log(JSON.stringify({ output, channelId: channel.id, banner: bannerText, connected: true }));
} finally {
  await browser?.close();
  await cleanup();
}
