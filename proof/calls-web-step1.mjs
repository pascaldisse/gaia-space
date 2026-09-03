import { appendFile } from "node:fs/promises";

const configPath = process.env.SPACE_PROOF_CONFIG ?? "/Users/pascaldisse/projects/gaia-space/bridge/room-link/config.json";
const peerToken = process.env.SPACE_PROOF_B_TOKEN;
if (!peerToken) throw new Error("SPACE_PROOF_B_TOKEN is required");
const config = await Bun.file(configPath).json();
const base = config.space.baseUrl.replace(/\/$/, "");
const aToken = config.space.personalAccessToken;
const peerId = process.env.SPACE_PROOF_B_PROFILE ?? "profile-6fab2895b258";
const now = Math.floor(Date.now() / 1000);
const suffix = `${now}-${crypto.randomUUID().slice(0, 8)}`;
const meetingId = `calls-proof3-${suffix}`;
const request = async (token, command, payload) => {
  const response = await fetch(`${base}/api/cmd/${command}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
};
const require200 = (label, result) => {
  if (result.status !== 200 || !result.json?.ok) throw new Error(`${label}: HTTP ${result.status} ${JSON.stringify(result.json)}`);
  return result.json.value;
};
const meeting = {
  id: meetingId, title: `Production two-peer proof ${meetingId}`, description: "Ephemeral live production proof",
  starts_at: now, ends_at: now + 3600, rrule: null, location: null, organizer_id: "forged-is-rebound",
  channel_id: null, visibility: "participants", modification_preference: "participants", archived: false,
  video_provider: "livekit", video_room_id: null, join_url: null, meeting_url: null, video_status: "scheduled",
  video_started_at: null, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null,
};
const created = await request(aToken, "create_meeting", { meeting }); require200("create_meeting", created);
const invited = await request(aToken, "invite_meeting_participant", { meetingId, profileId: peerId }); require200("invite_meeting_participant", invited);
const peerMeeting = await request(peerToken, "get_meeting", { id: meetingId }); require200("B get_meeting", peerMeeting);
const accepted = await request(peerToken, "set_meeting_participant_status", { meetingId, profileId: peerId, status: "accepted" }); require200("B accept", accepted);
const peerJoin = await request(peerToken, "join_meeting_call", { meetingId }); const join = require200("B join_meeting_call", peerJoin);
const aJoin = await request(aToken, "join_meeting_call", { meetingId }); const organizerJoin = require200("A join_meeting_call", aJoin);
const lines = [
  "", "# Production two-peer participant API transcript (redacted)", `UTC: ${new Date().toISOString()}`, `base: ${base}`, `meeting_id: ${meetingId}`, `peer_profile_id: ${peerId}`,
  `POST /api/cmd/create_meeting: HTTP ${created.status}; ok=${created.json?.ok === true}`,
  `POST /api/cmd/invite_meeting_participant: HTTP ${invited.status}; ok=${invited.json?.ok === true}`,
  `POST /api/cmd/get_meeting as B: HTTP ${peerMeeting.status}; ok=${peerMeeting.json?.ok === true}; identity=${peerMeeting.json?.value?.organizer_id === "profile-0ad5131d4b44" ? "organizer-bound" : "unexpected"}`,
  `POST /api/cmd/set_meeting_participant_status as B: HTTP ${accepted.status}; ok=${accepted.json?.ok === true}; status=accepted`,
  `POST /api/cmd/join_meeting_call as B: HTTP ${peerJoin.status}; ok=${peerJoin.json?.ok === true}; url=${join.url}; room=${join.room}; token=[REDACTED; present=${typeof join.token === "string" && join.token.length > 0}]`,
  `POST /api/cmd/join_meeting_call as A: HTTP ${aJoin.status}; ok=${aJoin.json?.ok === true}; url=${organizerJoin.url}; room=${organizerJoin.room}; token=[REDACTED; present=${typeof organizerJoin.token === "string" && organizerJoin.token.length > 0}]`, "",
];
await appendFile("proof/calls-web-join.txt", `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
