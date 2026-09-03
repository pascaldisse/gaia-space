import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const configPath = process.env.SPACE_PROOF_CONFIG ?? "/Users/pascaldisse/projects/gaia-space/bridge/room-link/config.json";
const config = await Bun.file(configPath).json();
const base = config.space.baseUrl.replace(/\/$/, "");
const aToken = config.space.personalAccessToken;
if (!aToken) throw new Error("space.personalAccessToken is required");
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const meetingId = `calls-web-live-${suffix}`;
const title = `Production web two peer ${meetingId}`;
const secret = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;

const request = async (token, command, payload) => {
  const response = await fetch(`${base}/api/cmd/${command}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const require200 = (label, result) => {
  if (result.status !== 200 || !result.body?.ok) throw new Error(`${label}: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  return result.body.value;
};
const createPeer = async () => {
  const username = `calls-proof3-b-${suffix}`;
  const password = secret();
  const response = await fetch(`${base}/api/users`, { method: "POST", headers: { authorization: `Bearer ${aToken}`, "content-type": "application/json" }, body: JSON.stringify({ username, password, display_name: "Calls Proof B", role: "member", profile_id: null }) });
  const body = await response.json().catch(() => null);
  if (response.status !== 200) throw new Error(`create B: HTTP ${response.status} ${JSON.stringify(body)}`);
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const loginBody = await login.json().catch(() => null);
  const setCookie = login.headers.get("set-cookie");
  if (login.status !== 200 || !setCookie) throw new Error(`login B: HTTP ${login.status} ${JSON.stringify(loginBody)}`);
  const cookie = setCookie.match(/(?:^|,\s*)(space_session=[^;]+)/)?.[1] ?? setCookie.split(";")[0];
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
  const meBody = await me.json().catch(() => null);
  if (me.status !== 200 || !meBody?.user?.profile_id) throw new Error(`B auth/me: HTTP ${me.status} ${JSON.stringify(meBody)}`);
  return { cookie, profileId: meBody.user.profile_id };
};
const installProbe = ({ token }) => {
  const originalFetch = window.fetch.bind(window);
  if (token) window.fetch = (input, init = {}) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    return originalFetch(input, { ...init, headers });
  };
  window.__callsProofWebSockets = [];
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = class extends OriginalWebSocket {
    constructor(...args) {
      super(...args);
      const entry = { url: String(args[0]), opened: false, errors: [], closes: [] };
      window.__callsProofWebSockets.push(entry);
      this.addEventListener("open", () => { entry.opened = true; });
      this.addEventListener("error", () => { entry.errors.push("error"); });
      this.addEventListener("close", event => { entry.closes.push({ code: event.code, reason: event.reason }); });
    }
  };
  window.__callsProofPeers = [];
  const OriginalPeer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends OriginalPeer {
    constructor(...args) {
      super(...args);
      const entry = { peer: this, timeline: [{ state: this.iceConnectionState, at: Date.now() }], candidates: [] };
      window.__callsProofPeers.push(entry);
      this.addEventListener("iceconnectionstatechange", () => entry.timeline.push({ state: this.iceConnectionState, at: Date.now() }));
      this.addEventListener("icecandidate", event => { if (event.candidate) entry.candidates.push(event.candidate.candidate.match(/ typ (host|srflx|prflx|relay)/)?.[1] ?? "unknown"); });
    }
  };
};
const inspect = async page => page.evaluate(async () => {
  const ice = [];
  for (const entry of window.__callsProofPeers ?? []) {
    const stats = await entry.peer.getStats();
    for (const stat of stats.values()) if (stat.type === "candidate-pair" && stat.state === "succeeded" && (stat.nominated || stat.selected)) {
      const local = stats.get(stat.localCandidateId); const remote = stats.get(stat.remoteCandidateId);
      ice.push({ local: local?.candidateType ?? null, remote: remote?.candidateType ?? null, protocol: local?.protocol ?? null });
    }
  }
  return {
    state: document.querySelector("[data-call-state]")?.textContent?.trim() ?? null,
    participants: document.querySelectorAll(".call-tile").length,
    tiles: [...document.querySelectorAll(".call-tile")].map(x => x.getAttribute("aria-label")),
    videos: document.querySelectorAll(".call-tile video").length,
    remoteVideos: [...document.querySelectorAll(".call-tile video")].filter(x => !x.muted).length,
    ws: window.__callsProofWebSockets ?? [],
    ice,
    peerDiagnostics: (window.__callsProofPeers ?? []).map(({ timeline, candidates }) => ({ timeline, candidates }))
  };
}).catch(error => ({ inspectError: String(error) }));

let browser; let contexts = {}; let pages = {}; let stage = "API setup"; let results = { a: null, b: null };
try {
  const peer = await createPeer();
  const now = Math.floor(Date.now() / 1000);
  const meeting = { id: meetingId, title, description: "Ephemeral browser production proof", starts_at: now, ends_at: now + 3600, rrule: null, location: null, organizer_id: "bound-by-server", channel_id: null, visibility: "participants", modification_preference: "participants", archived: false, video_provider: "livekit", video_room_id: null, join_url: null, meeting_url: null, video_status: "scheduled", video_started_at: null, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null };
  require200("A create_meeting", await request(aToken, "create_meeting", { meeting }));
  require200("A invite B", await request(aToken, "invite_meeting_participant", { meetingId, profileId: peer.profileId }));
  // B acceptance uses its cookie, never A's PAT.
  const accept = await fetch(`${base}/api/cmd/set_meeting_participant_status`, { method: "POST", headers: { cookie: peer.cookie, "content-type": "application/json" }, body: JSON.stringify({ meetingId, profileId: peer.profileId, status: "accepted" }) });
  const acceptBody = await accept.json().catch(() => null);
  if (accept.status !== 200 || !acceptBody?.ok) throw new Error(`B accept: HTTP ${accept.status} ${JSON.stringify(acceptBody)}`);

  browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  contexts = { a: await browser.newContext(), b: await browser.newContext() };
  await contexts.b.addCookies([{ name: peer.cookie.split("=")[0], value: peer.cookie.slice(peer.cookie.indexOf("=") + 1), domain: new URL(base).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
  pages = { a: await contexts.a.newPage(), b: await contexts.b.newPage() };
  await pages.a.addInitScript(installProbe, { token: aToken });
  await pages.b.addInitScript(installProbe, { token: null });
  stage = "CallPanel";
  const detailUrl = `${base}/meetings/${encodeURIComponent(meetingId)}`;
  await Promise.all(Object.values(pages).map(page => page.goto(detailUrl, { waitUntil: "networkidle" })));
  // The canonical detail route resolves the Meetings surface; select the visible row to mount CallPanel.
  await Promise.all(Object.values(pages).map(async page => { await page.getByRole("button", { name: title }).click(); await page.getByRole("button", { name: "Join call" }).waitFor({ state: "visible", timeout: 20_000 }); }));
  stage = "joining";
  await pages.a.getByRole("button", { name: "Join call" }).click();
  await pages.b.getByRole("button", { name: "Join call" }).click();
  await Promise.all(Object.values(pages).map(page => page.waitForFunction(() => document.querySelector("[data-call-state]")?.textContent === "connected" && document.querySelectorAll(".call-tile").length >= 2 && [...document.querySelectorAll(".call-tile video")].some(video => !video.muted), undefined, { timeout: 45_000 })));
  results = { a: await inspect(pages.a), b: await inspect(pages.b) };
  await pages.a.screenshot({ path: "proof/calls-web-2peers-a.png", fullPage: false });
  await pages.b.screenshot({ path: "proof/calls-web-2peers-b.png", fullPage: false });
  await writeFile("proof/calls-web-2peers.txt", ["# Production browser two-peer LiveKit proof", `UTC: ${new Date().toISOString()}`, `base: ${base}`, `direct_meeting_url: ${detailUrl}`, `meeting_id: ${meetingId}`, "launch: chromium --use-fake-ui-for-media-stream --use-fake-device-for-media-stream", `A: ${JSON.stringify(results.a)}`, `B: ${JSON.stringify(results.b)}`, "screenshots: proof/calls-web-2peers-a.png, proof/calls-web-2peers-b.png", ""].join("\n"));
  console.log(JSON.stringify({ meetingId, detailUrl, results }, null, 2));
} catch (error) {
  results = { a: pages.a ? await inspect(pages.a) : null, b: pages.b ? await inspect(pages.b) : null };
  if (pages.a) await pages.a.screenshot({ path: "proof/calls-web-2peers-a.png", fullPage: false }).catch(() => {});
  if (pages.b) await pages.b.screenshot({ path: "proof/calls-web-2peers-b.png", fullPage: false }).catch(() => {});
  const detailUrl = `${base}/meetings/${encodeURIComponent(meetingId)}`;
  const safeError = String(error).replaceAll(aToken, "[REDACTED]");
  await writeFile("proof/calls-web-2peers.txt", ["# Production browser two-peer LiveKit proof — FAILED", `UTC: ${new Date().toISOString()}`, `base: ${base}`, `direct_meeting_url: ${detailUrl}`, `meeting_id: ${meetingId}`, `stage: ${stage}`, `error: ${safeError}`, `A: ${JSON.stringify(results.a)}`, `B: ${JSON.stringify(results.b)}`, ""].join("\n"));
  console.error(safeError); process.exitCode = 1;
} finally {
  await Promise.all(Object.values(contexts).map(context => context.close()));
  await browser?.close();
}
