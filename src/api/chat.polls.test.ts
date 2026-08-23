import { test, expect, afterEach } from "bun:test";
import { chatApi, type PollView } from "./chat";
import { ballotAfterClick, optionShare, pollDraftError, pollIsOpen } from "../poll";

// Wire contract: command names and argument keys must match src-tauri/src/chat.rs.
const seen: { command: string; args: Record<string, unknown> }[] = [];
afterEach(() => { seen.length = 0; delete (window as any).__TAURI_INTERNALS__; });

function record(result: unknown = {}) {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown>) => { seen.push({ command, args }); return result; },
  };
}

function poll(overrides: Partial<PollView> = {}): PollView {
  return {
    id: "p-1",
    message_id: "poll-p-1",
    channel_id: "c",
    author_id: "pb",
    question: "lunch?",
    multiple_choice: false,
    anonymous: false,
    closed_at: null,
    created_at: 1,
    updated_at: 1,
    voter_count: 0,
    options: [
      { id: "o0", position: 0, text: "pizza", vote_count: 0, me_voted: false },
      { id: "o1", position: 1, text: "sushi", vote_count: 0, me_voted: false },
    ],
    ...overrides,
  };
}

test("creating a poll sends its options in order and lets the backend default the flags", async () => {
  record();
  await chatApi.createPoll({ id: "p-1", channelId: "c", authorId: "pb", question: "lunch?", options: ["pizza", "sushi"] });
  expect(seen[0]).toEqual({
    command: "create_poll",
    args: { id: "p-1", channelId: "c", authorId: "pb", question: "lunch?", options: ["pizza", "sushi"], multipleChoice: null, anonymous: null },
  });
  await chatApi.createPoll({ id: "p-2", channelId: "c", authorId: "pb", question: "days?", options: ["mon", "tue"], multipleChoice: true, anonymous: true });
  expect(seen[1].args.multipleChoice).toBe(true);
  expect(seen[1].args.anonymous).toBe(true);
});

test("a ballot names option ids, and an empty ballot is a withdrawal", async () => {
  record();
  await chatApi.votePoll("p-1", "pb", ["o0"]);
  expect(seen[0]).toEqual({ command: "vote_poll", args: { pollId: "p-1", voterId: "pb", optionIds: ["o0"] } });
  await chatApi.votePoll("p-1", "pb", []);
  expect(seen[1].args.optionIds).toEqual([]);
  await chatApi.closePoll("p-1", "pb");
  expect(seen[2]).toEqual({ command: "close_poll", args: { pollId: "p-1", authorId: "pb" } });
});

test("a single-choice click replaces the pick and re-clicking withdraws it", () => {
  const p = poll({ options: [
    { id: "o0", position: 0, text: "pizza", vote_count: 1, me_voted: true },
    { id: "o1", position: 1, text: "sushi", vote_count: 0, me_voted: false },
  ] });
  expect(ballotAfterClick(p, "o1")).toEqual(["o1"]);
  expect(ballotAfterClick(p, "o0")).toEqual([]);
});

test("a multiple-choice click toggles inside the ballot and keeps option order", () => {
  const p = poll({ multiple_choice: true, options: [
    { id: "o0", position: 0, text: "mon", vote_count: 1, me_voted: false },
    { id: "o1", position: 1, text: "tue", vote_count: 1, me_voted: true },
  ] });
  expect(ballotAfterClick(p, "o0")).toEqual(["o0", "o1"]);
  expect(ballotAfterClick(p, "o1")).toEqual([]);
});

test("shares are of the electorate, so a multi-choice poll may exceed 100% in total", () => {
  const p = poll({ multiple_choice: true, voter_count: 2, options: [
    { id: "o0", position: 0, text: "mon", vote_count: 2, me_voted: true },
    { id: "o1", position: 1, text: "tue", vote_count: 1, me_voted: false },
  ] });
  expect(optionShare(p.options[0], p.voter_count)).toBe(100);
  expect(optionShare(p.options[1], p.voter_count)).toBe(50);
  // No voters yet: no division by zero, no bar.
  expect(optionShare(p.options[0], 0)).toBe(0);
});

test("a closed poll is not votable and the composer refuses a thin or duplicate ballot", () => {
  expect(pollIsOpen(poll())).toBe(true);
  expect(pollIsOpen(poll({ closed_at: 99 }))).toBe(false);
  expect(pollDraftError("", ["a", "b"])).toBeTruthy();
  expect(pollDraftError("q", ["a", ""])).toBeTruthy();
  expect(pollDraftError("q", ["a", "A"])).toBeTruthy();
  expect(pollDraftError("q", ["a", "b"])).toBeNull();
});
