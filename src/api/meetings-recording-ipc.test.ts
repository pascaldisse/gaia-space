import { test, expect, afterEach } from "bun:test";
import { meetingsApi } from "./meetings";

// Regression: recording control must not accept caller-supplied LiveKit settings
// NOR a caller-supplied actor. The Egress endpoint, output filepath and timeouts
// live in the native process (a webview that could pass them could redirect the
// recording to an attacker sink), and the acting profile is resolved natively (a
// webview that could pass it could record as the organizer).
const seen: { command: string; args: Record<string, unknown> }[] = [];
afterEach(() => { seen.length = 0; delete (window as any).__TAURI_INTERNALS__; });

test("start/stop/list recording send only the meeting id over IPC", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: Record<string, unknown>) => { seen.push({ command, args }); return {}; } };
  const start = meetingsApi.startRecording as (m: string, ...rest: unknown[]) => Promise<unknown>;
  const stop = meetingsApi.stopRecording as (m: string, ...rest: unknown[]) => Promise<unknown>;
  const list = meetingsApi.recordings as (m: string, ...rest: unknown[]) => Promise<unknown>;
  // Every extra argument an attacker-controlled page could try to smuggle in.
  await start("meeting-1", "organizer", { egress_url: "http://attacker.test", recording_filepath: "/etc/passwd", egress_timeout_ms: 1 });
  await stop("meeting-1", "organizer", { egress_url: "http://attacker.test" });
  await list("meeting-1", "organizer");
  expect(seen.map(entry => entry.command)).toEqual(["start_meeting_recording", "stop_meeting_recording", "list_meeting_recordings"]);
  for (const entry of seen) expect(Object.keys(entry.args).sort()).toEqual(["meetingId"]);
  const serialised = JSON.stringify(seen);
  expect(serialised).not.toContain("organizer");
  expect(serialised).not.toContain("attacker.test");
});

// Same boundary for the call/runtime surface: joining names the meeting only, and the
// LiveKit runtime commands name nothing at all.
test("join/start/status send no identity and no config over IPC", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: Record<string, unknown>) => { seen.push({ command, args }); return {}; } };
  const join = meetingsApi.joinCall as (m: string, ...rest: unknown[]) => Promise<unknown>;
  const startServer = meetingsApi.startServer as (...rest: unknown[]) => Promise<unknown>;
  const status = meetingsApi.status as (...rest: unknown[]) => Promise<unknown>;
  await join("meeting-1", "organizer", "Organizer", { api_secret: "attacker-secret" });
  await startServer({ server_path: "/tmp/attacker", api_secret: "attacker-secret" });
  await status({ api_secret: "attacker-secret" });
  expect(seen.map(entry => entry.command)).toEqual(["join_meeting_call", "start_livekit_server", "livekit_server_status"]);
  expect(Object.keys(seen[0].args).sort()).toEqual(["meetingId"]);
  for (const entry of seen.slice(1)) expect(Object.keys(entry.args)).toEqual([]);
  const wire = JSON.stringify(seen);
  expect(wire).not.toContain("organizer");
  expect(wire).not.toContain("attacker");
});
