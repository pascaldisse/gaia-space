import { afterEach, describe, expect, test } from "bun:test";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import MeetingWhereField, { DEFAULT_MEETING_WHERE, meetingWhereKindOf, meetingWherePayload, type MeetingWhereValue } from "./MeetingWhereField";

// HOW A MEETING IS REACHED IS ONE CHOICE, THREE ANSWERS — exclusive by construction.
// `meetingWherePayload` is the ONLY place a choice becomes the three Meeting fields it
// may touch, so whatever was typed for a choice no longer selected never reaches the
// payload sent to the server (a stale meeting_url must not survive switching to "In
// person", and a stale location must not survive switching to "Video call").

let dispose: (() => void) | undefined;
const settle = () => new Promise((done) => setTimeout(done, 10));

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
});

const mount = (initial: MeetingWhereValue = DEFAULT_MEETING_WHERE) => {
  const [value, setValue] = createSignal(initial);
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <MeetingWhereField value={value()} onChange={setValue} /> as any, host);
  const choice = (label: string) => [...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === label) as HTMLButtonElement;
  return { host, value, choice };
};

describe("choice -> payload mapping", () => {
  test("Video call: video_provider 'livekit', meeting_url and location both null", () => {
    expect(meetingWherePayload({ kind: "video", meeting_url: "https://old.example/link", location: "Old room" }))
      .toEqual({ video_provider: "livekit", meeting_url: null, location: null });
  });

  test("External link: video_provider null, meeting_url trimmed, location null", () => {
    expect(meetingWherePayload({ kind: "link", meeting_url: "  https://meet.google.com/abc-defg-hij  ", location: "Old room" }))
      .toEqual({ video_provider: null, meeting_url: "https://meet.google.com/abc-defg-hij", location: null });
    // An empty link is stored as null, not as an empty string.
    expect(meetingWherePayload({ kind: "link", meeting_url: "   ", location: "" }).meeting_url).toBeNull();
  });

  test("In person: video_provider null, meeting_url null, location trimmed", () => {
    expect(meetingWherePayload({ kind: "in_person", meeting_url: "https://old.example/link", location: "  Room 4B  " }))
      .toEqual({ video_provider: null, meeting_url: null, location: "Room 4B" });
    expect(meetingWherePayload({ kind: "in_person", meeting_url: "", location: "   " }).location).toBeNull();
  });
});

describe("meetingWhereKindOf: inferring the choice already implied by stored data", () => {
  test("video_provider 'livekit' wins outright", () => {
    expect(meetingWhereKindOf({ video_provider: "livekit", meeting_url: "https://x", location: "Room" })).toBe("video");
  });
  test("a meeting_url with no livekit provider reads as 'link'", () => {
    expect(meetingWhereKindOf({ video_provider: null, meeting_url: "https://x", location: null })).toBe("link");
  });
  test("a location alone reads as 'in_person'", () => {
    expect(meetingWhereKindOf({ video_provider: null, meeting_url: null, location: "Room 4B" })).toBe("in_person");
  });
  test("nothing set defaults to 'video'", () => {
    expect(meetingWhereKindOf({ video_provider: null, meeting_url: null, location: null })).toBe("video");
  });
});

describe("the field itself", () => {
  test("three choices are offered, and exactly one is marked checked", () => {
    const { host, choice } = mount();
    expect([...host.querySelectorAll('[role="radio"]')].map((b) => b.textContent)).toEqual(["Video call", "External link", "In person"]);
    expect(choice("Video call").getAttribute("aria-checked")).toBe("true");
    expect(choice("External link").getAttribute("aria-checked")).toBe("false");
  });

  test("picking External link reveals the link field; a bad address is refused where it was typed", async () => {
    const { host, choice, value } = mount();
    choice("External link").click();
    await settle();
    expect(value().kind).toBe("link");
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Meeting link"]');
    expect(field).toBeTruthy();
    field!.value = "not-a-url";
    field!.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(value().meeting_url).toBe("not-a-url");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("http");
  });

  test("picking In person reveals the location field instead, and Video call shows neither", async () => {
    const { host, choice, value } = mount();
    choice("In person").click();
    await settle();
    expect(value().kind).toBe("in_person");
    expect(host.querySelector('input[aria-label="Location"]')).toBeTruthy();
    expect(host.querySelector('input[aria-label="Meeting link"]')).toBeNull();

    choice("Video call").click();
    await settle();
    expect(host.querySelector('input[aria-label="Location"]')).toBeNull();
    expect(host.querySelector('input[aria-label="Meeting link"]')).toBeNull();
  });
});
