import { expect, test } from "bun:test";
import { canSendDraft, uploadableAttachments } from "./chatAttachments";

const readable = { id: "a", data_url: "data:,hi" };
const unreadable = { id: "b", data_url: "" };

test("only attachments with a payload are sent", () => {
  expect(uploadableAttachments([readable, unreadable]).map((a) => a.id)).toEqual(["a"]);
  expect(uploadableAttachments([unreadable])).toEqual([]);
});

test("a draft of nothing but rejected files is not a message", () => {
  // the historic hole: an oversized file left an empty message behind
  expect(canSendDraft("", [unreadable])).toBe(false);
  expect(canSendDraft("   ", [unreadable])).toBe(false);
  expect(canSendDraft("", [])).toBe(false);
  // text alone, or one readable file alone, is enough
  expect(canSendDraft("hello", [unreadable])).toBe(true);
  expect(canSendDraft("", [unreadable, readable])).toBe(true);
});
