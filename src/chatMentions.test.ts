import { test, expect } from "bun:test";
import { insertMention, mentionCandidates, mentionQuery, survivingMentions } from "./chatMentions";

const bob = { id: "pb", username: "bob", display_name: "Bob Stone" };
const bea = { id: "pc", username: "bea", display_name: "Bea Rao" };
const people = [bob, bea];

test("the menu opens only on an unfinished @ fragment", () => {
  expect(mentionQuery("hi @bo")).toBe("bo");
  expect(mentionQuery("@")).toBe("");
  // a finished mention followed by a space is not an open query, or every message
  // would keep the menu on screen forever
  expect(mentionQuery("hi @Bob Stone ")).toBeNull();
  expect(mentionQuery("mail me at a@b")).toBeNull();
});

test("a candidate matches display name or username, and the fragment is replaced in place", () => {
  expect(mentionCandidates("hi @b", people).map((p) => p.id)).toEqual(["pb", "pc"]);
  expect(mentionCandidates("hi @bea", people).map((p) => p.id)).toEqual(["pc"]);
  expect(mentionCandidates("no mention here", people)).toEqual([]);
  expect(insertMention("hi @bo", bob)).toBe("hi @Bob Stone ");
  expect(insertMention("@bo", bob)).toBe("@Bob Stone ");
});

test("an edit keeps only the mentions whose name is still written in the text", () => {
  expect(survivingMentions("hi @Bob Stone and @Bea Rao", ["pb", "pc"], people)).toEqual(["pb", "pc"]);
  // deleting the name is how a user un-mentions someone
  expect(survivingMentions("hi @Bob Stone", ["pb", "pc"], people)).toEqual(["pb"]);
  expect(survivingMentions("nobody now", ["pb"], people)).toEqual([]);
  // an id whose profile is unknown cannot be proven present, so it does not survive
  expect(survivingMentions("hi @Bob Stone", ["ghost"], people)).toEqual([]);
  // the raw username spelling counts as well
  expect(survivingMentions("hi @bob", ["pb"], people)).toEqual(["pb"]);
});
