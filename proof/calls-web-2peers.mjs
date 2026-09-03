import { appendFile } from "node:fs/promises";
import { chromium } from "playwright";

const configPath = process.env.SPACE_PROOF_CONFIG ?? "/Users/pascaldisse/projects/gaia-space/bridge/room-link/config.json";
const config = await Bun.file(configPath).json();
const base = config.space.baseUrl.replace(/\/$/, "");
const adminHeaders = { authorization: `Bearer ${config.space.personalAccessToken}`, "content-type": "application/json" };
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const secret = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;
const createUser = async (label) => {
  const username = `calls-proof3-${label}-${suffix}`;
  const password = secret();
  const response = await fetch(`${base}/api/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ username, password, display_name: `Calls Proof ${label.toUpperCase()}`, role: "member", profile_id: null }) });
  const json = await response.json().catch(() => null);
  if (response.status !== 200) throw new Error(`create ${label}: HTTP ${response.status} ${JSON.stringify(json)}`);
  return { username, password };
};
const initProbe = () => {
  const prior = window.WebSocket;
  window.__callsProofWebSockets = [];
  window.WebSocket = class extends prior { constructor(...args) { super(...args); window.__callsProofWebSockets.push(String(args[0])); } };
  window.__callsProofPeers = [];
  const PriorPeer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends PriorPeer { constructor(...args) { super(...args); window.__callsProofPeers.push(this); } };
};
const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const users = { a: await createUser("a"), b: await createUser("b") };
const contexts = { a: await browser.newContext(), b: await browser.newContext() };
const pages = { a: await contexts.a.newPage(), b: await contexts.b.newPage() };
for (const page of Object.values(pages)) await page.addInitScript(initProbe);
const login = async (page, user) => {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.locator("input").first().fill(user.username);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Meetings").waitFor({ state: "visible", timeout: 20_000 });
};
let meetingId = "";
let title = "";
let results = { a: null, b: null };
try {
  await login(pages.a, users.a); await login(pages.b, users.b);
  const identities = {};
  for (const [key, page] of Object.entries(pages)) identities[key] = await page.evaluate(async () => (await (await fetch("api/auth/me", { credentials: "include" })).json()).user);
  const now = Math.floor(Date.now() / 1000); meetingId = `calls-web-live-${suffix}`; title = `Production web two peer ${meetingId}`;
  const create = await pages.a.evaluate(async ({ meetingId, title, now }) => {
    const meeting = { id: meetingId, title, description: "Ephemeral browser production proof", starts_at: now, ends_at: now + 3600, rrule: null, location: null, organizer_id: "body-is-bound", channel_id: null, visibility: "participants", modification_preference: "participants", archived: false, video_provider: "livekit", video_room_id: null, join_url: null, meeting_url: null, video_status: "scheduled", video_started_at: null, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null };
    const request = async (cmd, body) => { const r = await fetch(`api/cmd/${cmd}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    return { create: await request("create_meeting", { meeting }) };
  }, { meetingId, title, now });
  if (create.create.status !== 200 || !create.create.body.ok) throw new Error(`browser create: ${JSON.stringify(create)}`);
  const invite = await pages.a.evaluate(async ({ meetingId, profileId }) => { const r = await fetch("api/cmd/invite_meeting_participant", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ meetingId, profileId }) }); return { status: r.status, body: await r.json() }; }, { meetingId, profileId: identities.b.profile_id });
  if (invite.status !== 200 || !invite.body.ok) throw new Error(`browser invite: ${JSON.stringify(invite)}`);
  const accept = await pages.b.evaluate(async ({ meetingId, profileId }) => { const r = await fetch("api/cmd/set_meeting_participant_status", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ meetingId, profileId, status: "accepted" }) }); return { status: r.status, body: await r.json() }; }, { meetingId, profileId: identities.b.profile_id });
  if (accept.status !== 200 || !accept.body.ok) throw new Error(`browser accept: ${JSON.stringify(accept)}`);
  for (const page of Object.values(pages)) { await page.getByLabel("Meetings").click(); await page.getByText(title, { exact: true }).waitFor({ state: "visible", timeout: 20_000 }); await page.getByText(title, { exact: true }).click(); await page.getByRole("button", { name: "Join call" }).waitFor({ state: "visible", timeout: 20_000 }); }
  await pages.a.getByRole("button", { name: "Join call" }).click();
  await pages.b.getByRole("button", { name: "Join call" }).click();
  await Promise.all(Object.values(pages).map(page => page.waitForFunction(() => document.querySelector("[data-call-state]")?.textContent === "connected" && document.querySelectorAll(".call-tile").length >= 2, undefined, { timeout: 40_000 })));
  const inspect = async (page) => page.evaluate(async () => {
    const ice = [];
    for (const peer of window.__callsProofPeers ?? []) {
      for (const stat of (await peer.getStats()).values()) if (stat.type === "candidate-pair" && stat.state === "succeeded" && (stat.nominated || stat.selected)) {
        const local = (await peer.getStats()).get(stat.localCandidateId); const remote = (await peer.getStats()).get(stat.remoteCandidateId);
        ice.push({ local: local?.candidateType ?? null, remote: remote?.candidateType ?? null, protocol: local?.protocol ?? null });
      }
    }
    return { state: document.querySelector("[data-call-state]")?.textContent?.trim() ?? null, participants: document.querySelectorAll(".call-tile").length, tiles: [...document.querySelectorAll(".call-tile")].map(x => x.getAttribute("aria-label")), videos: document.querySelectorAll(".call-tile video").length, remoteVideos: [...document.querySelectorAll(".call-tile video")].filter(x => !x.muted).length, ws: window.__callsProofWebSockets ?? [], ice };
  });
  results = { a: await inspect(pages.a), b: await inspect(pages.b) };
  await pages.a.screenshot({ path: "proof/calls-web-2peers-a.png", fullPage: false }); await pages.b.screenshot({ path: "proof/calls-web-2peers-b.png", fullPage: false });
  const lines = ["# Production browser two-peer LiveKit proof", `UTC: ${new Date().toISOString()}`, `base: ${base}`, `meeting_id: ${meetingId}`, "launch: chromium --use-fake-ui-for-media-stream --use-fake-device-for-media-stream", `A: ${JSON.stringify(results.a)}`, `B: ${JSON.stringify(results.b)}`, "screenshots: proof/calls-web-2peers-a.png, proof/calls-web-2peers-b.png", ""];
  await appendFile("proof/calls-web-2peers.txt", `${lines.join("\n")}\n`); console.log(lines.join("\n"));
} catch (error) {
  const snapshot = async (page) => page.evaluate(() => ({ state: document.querySelector("[data-call-state]")?.textContent?.trim() ?? null, tiles: document.querySelectorAll(".call-tile").length, body: document.body.innerText.slice(0, 1000), ws: window.__callsProofWebSockets ?? [] })).catch(() => null);
  results = { a: await snapshot(pages.a), b: await snapshot(pages.b) };
  const lines = ["# Production browser two-peer LiveKit proof — FAILED", `UTC: ${new Date().toISOString()}`, `base: ${base}`, `meeting_id: ${meetingId || "not-created"}`, `error: ${String(error).replaceAll(config.space.personalAccessToken, "[REDACTED]")}`, `A: ${JSON.stringify(results.a)}`, `B: ${JSON.stringify(results.b)}`, ""];
  await appendFile("proof/calls-web-2peers.txt", `${lines.join("\n")}\n`); console.error(lines.join("\n")); process.exitCode = 1;
} finally { await Promise.all(Object.values(contexts).map(context => context.close())); await browser.close(); }
