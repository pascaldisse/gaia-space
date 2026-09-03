import { appendFile, writeFile } from "node:fs/promises";
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
const request = async (credential, command, payload) => {
  const response = await fetch(`${base}/api/cmd/${command}`, { method: "POST", headers: { ...credential, "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const require200 = (label, result) => {
  if (result.status !== 200 || !result.body?.ok) throw new Error(`${label}: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  return result.body.value;
};
const createPeer = async side => {
  const username = `calls-proof3-${side}-${suffix}`;
  const password = secret();
  const response = await fetch(`${base}/api/users`, { method: "POST", headers: { authorization: `Bearer ${aToken}`, "content-type": "application/json" }, body: JSON.stringify({ username, password, display_name: `Calls Proof ${side.toUpperCase()}`, role: "member", profile_id: null }) });
  const body = await response.json().catch(() => null);
  if (response.status !== 200) throw new Error(`create ${side}: HTTP ${response.status} ${JSON.stringify(body)}`);
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const loginBody = await login.json().catch(() => null);
  const setCookie = login.headers.get("set-cookie");
  if (login.status !== 200 || !setCookie) throw new Error(`login ${side}: HTTP ${login.status} ${JSON.stringify(loginBody)}`);
  const cookie = setCookie.match(/(?:^|,\s*)(space_session=[^;]+)/)?.[1] ?? setCookie.split(";")[0];
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
  const meBody = await me.json().catch(() => null);
  if (me.status !== 200 || !meBody?.user?.profile_id) throw new Error(`${side} auth/me: HTTP ${me.status} ${JSON.stringify(meBody)}`);
  return { cookie, profileId: meBody.user.profile_id };
};
const installProbe = () => {
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
const inspect = page => page.evaluate(async () => {
  const summarize = (stats, direction, kind) => [...stats.values()]
    .filter(stat => stat.type === `${direction}-rtp` && (stat.kind === kind || stat.mediaType === kind) && !stat.isRemote)
    .reduce((total, stat) => ({
      framesDecoded: total.framesDecoded + (stat.framesDecoded ?? 0),
      framesSent: total.framesSent + (stat.framesSent ?? 0),
      bytesReceived: total.bytesReceived + (stat.bytesReceived ?? 0),
      bytesSent: total.bytesSent + (stat.bytesSent ?? 0),
      packetsReceived: total.packetsReceived + (stat.packetsReceived ?? 0),
      packetsSent: total.packetsSent + (stat.packetsSent ?? 0),
      reports: total.reports + 1,
    }), { framesDecoded: 0, framesSent: 0, bytesReceived: 0, bytesSent: 0, packetsReceived: 0, packetsSent: 0, reports: 0 });
  const stats = await Promise.all((window.__callsProofPeers ?? []).map(async entry => entry.peer.getStats()));
  const media = {};
  for (const kind of ["video", "audio"]) media[kind] = {
    inbound: stats.reduce((out, item) => Object.assign(out, Object.fromEntries(Object.entries(summarize(item, "inbound", kind)).map(([key, value]) => [key, out[key] + value]))), { framesDecoded: 0, framesSent: 0, bytesReceived: 0, bytesSent: 0, packetsReceived: 0, packetsSent: 0, reports: 0 }),
    outbound: stats.reduce((out, item) => Object.assign(out, Object.fromEntries(Object.entries(summarize(item, "outbound", kind)).map(([key, value]) => [key, out[key] + value]))), { framesDecoded: 0, framesSent: 0, bytesReceived: 0, bytesSent: 0, packetsReceived: 0, packetsSent: 0, reports: 0 }),
  };
  const ice = [];
  for (const item of stats) for (const stat of item.values()) if (stat.type === "candidate-pair" && stat.state === "succeeded" && (stat.nominated || stat.selected)) {
    const local = item.get(stat.localCandidateId); const remote = item.get(stat.remoteCandidateId);
    ice.push({ local: local?.candidateType ?? null, remote: remote?.candidateType ?? null, protocol: local?.protocol ?? null });
  }
  const videos = [...document.querySelectorAll("video")].map(video => ({ muted: video.muted, srcObject: !!video.srcObject, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight, paused: video.paused }));
  return {
    state: document.querySelector("[data-call-state]")?.textContent?.trim() ?? null,
    participants: document.querySelectorAll(".call-tile").length,
    tiles: [...document.querySelectorAll(".call-tile")].map(x => x.getAttribute("aria-label")),
    videos,
    remoteVideos: videos.filter(video => !video.muted),
    media,
    ws: (window.__callsProofWebSockets ?? []).map(({ url, opened, errors, closes }) => ({ url: url.replace(/\?.*$/, ""), opened, errors, closes })),
    ice,
    peerDiagnostics: (window.__callsProofPeers ?? []).map(({ timeline, candidates }) => ({ timeline, candidates })),
  };
}).catch(error => ({ inspectError: String(error) }));
const capture = async (page, side) => {
  const tiles = page.locator(".call-tiles");
  await tiles.scrollIntoViewIfNeeded();
  await tiles.screenshot({ path: `proof/calls-web-2peers-${side}-tiles.png` });
  await page.screenshot({ path: `proof/calls-web-2peers-${side}.png`, fullPage: true });
};
let browser; let contexts = {}; let pages = {}; let stage = "API setup"; let samples = { a: [], b: [] };
const detailUrl = `${base}/meetings/${encodeURIComponent(meetingId)}`;
try {
  const aPeer = await createPeer("a");
  const bPeer = await createPeer("b");
  const now = Math.floor(Date.now() / 1000);
  const meeting = { id: meetingId, title, description: "Ephemeral browser production proof", starts_at: now, ends_at: now + 3600, rrule: null, location: null, organizer_id: "bound-by-server", channel_id: null, visibility: "participants", modification_preference: "participants", archived: false, video_provider: "livekit", video_room_id: null, join_url: null, meeting_url: null, video_status: "scheduled", video_started_at: null, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null };
  require200("A create_meeting", await request({ cookie: aPeer.cookie }, "create_meeting", { meeting }));
  require200("A invite B", await request({ cookie: aPeer.cookie }, "invite_meeting_participant", { meetingId, profileId: bPeer.profileId }));
  const accept = await fetch(`${base}/api/cmd/set_meeting_participant_status`, { method: "POST", headers: { cookie: bPeer.cookie, "content-type": "application/json" }, body: JSON.stringify({ meetingId, profileId: bPeer.profileId, status: "accepted" }) });
  const acceptBody = await accept.json().catch(() => null);
  if (accept.status !== 200 || !acceptBody?.ok) throw new Error(`B accept: HTTP ${accept.status} ${JSON.stringify(acceptBody)}`);
  browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  contexts = { a: await browser.newContext(), b: await browser.newContext() };
  await Promise.all(Object.values(contexts).map(context => context.grantPermissions(["camera", "microphone"], { origin: new URL(base).origin })));
  const addSession = (context, cookie) => context.addCookies([{ name: cookie.split("=")[0], value: cookie.slice(cookie.indexOf("=") + 1), domain: new URL(base).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
  await Promise.all([addSession(contexts.a, aPeer.cookie), addSession(contexts.b, bPeer.cookie)]);
  pages = { a: await contexts.a.newPage(), b: await contexts.b.newPage() };
  await pages.a.addInitScript(installProbe); await pages.b.addInitScript(installProbe);
  stage = "CallPanel";
  await Promise.all(Object.values(pages).map(page => page.goto(detailUrl, { waitUntil: "networkidle" })));
  await Promise.all(Object.values(pages).map(async page => {
    const row = page.locator("button.meeting-row").filter({ hasText: title });
    if (await row.count() !== 1) throw new Error(`created meeting row count: ${await row.count()}`);
    await row.click();
    await page.getByRole("button", { name: "Join call", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  }));
  stage = "joining";
  await pages.a.getByRole("button", { name: "Join call" }).click();
  await pages.b.getByRole("button", { name: "Join call" }).click();
  await Promise.all(Object.values(pages).map(page => page.waitForFunction(() => document.querySelector("[data-call-state]")?.textContent === "connected" && document.querySelectorAll(".call-tile").length >= 2, undefined, { timeout: 45_000 })));
  stage = "media polling";
  for (let i = 0; i < 3; i++) {
    samples.a.push(await inspect(pages.a)); samples.b.push(await inspect(pages.b));
    if (i < 2) await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  await Promise.all([capture(pages.a, "a"), capture(pages.b, "b")]);
  const valid = ["a", "b"].every(side => {
    const first = samples[side][0]; const last = samples[side].at(-1);
    return last.media.video.inbound.framesDecoded > first.media.video.inbound.framesDecoded && last.media.video.inbound.framesDecoded > 0 && last.remoteVideos.some(video => video.videoWidth > 0 && video.videoHeight > 0);
  });
  await appendFile("proof/calls-web-2peers.txt", [`\n## MEDIA run — ${new Date().toISOString()}`, `base: ${base}`, `direct_meeting_url: ${detailUrl}`, `meeting_id: ${meetingId}`, "launch: chromium headless=true --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --autoplay-policy=no-user-gesture-required", `A_samples: ${JSON.stringify(samples.a)}`, `B_samples: ${JSON.stringify(samples.b)}`, "screenshots_fullpage: proof/calls-web-2peers-a.png, proof/calls-web-2peers-b.png", "screenshots_tiles: proof/calls-web-2peers-a-tiles.png, proof/calls-web-2peers-b-tiles.png", `verdict: ${valid ? "VERIFIED" : "UNVERIFIED"}`, ""].join("\n"));
  console.log(JSON.stringify({ meetingId, detailUrl, samples, verdict: valid ? "VERIFIED" : "UNVERIFIED" }, null, 2));
  if (!valid) process.exitCode = 2;
} catch (error) {
  const safeError = String(error).replaceAll(aToken, "[REDACTED]");
  await Promise.all(Object.entries(pages).map(async ([side, page]) => capture(page, side).catch(() => {})));
  await appendFile("proof/calls-web-2peers.txt", [`\n## MEDIA run — ${new Date().toISOString()} — FAILED`, `base: ${base}`, `direct_meeting_url: ${detailUrl}`, `meeting_id: ${meetingId}`, `stage: ${stage}`, `error: ${safeError}`, `A_samples: ${JSON.stringify(samples.a)}`, `B_samples: ${JSON.stringify(samples.b)}`, "screenshots_fullpage: proof/calls-web-2peers-a.png, proof/calls-web-2peers-b.png", "screenshots_tiles: proof/calls-web-2peers-a-tiles.png, proof/calls-web-2peers-b-tiles.png", ""].join("\n"));
  console.error(safeError); process.exitCode = 1;
} finally {
  await Promise.all(Object.values(contexts).map(context => context.close()));
  await browser?.close();
}
