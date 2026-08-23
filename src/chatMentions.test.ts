import { test, expect } from "bun:test";
import { insertMention, mentionCandidates, mentionQuery, survivingMentions, type MentionTarget } from "./chatMentions";

const bob = { id: "pb", username: "bob", display_name: "Bob Stone" };
const bea = { id: "pc", username: "bea", display_name: "Bea Rao" };
const people = [bob, bea];
const targets: MentionTarget[] = [
  { kind: "profile", id: "pb", name: "Bob Stone", secondary: "bob" },
  { kind: "profile", id: "pc", name: "Bea Rao", secondary: "bea" },
  { kind: "team", id: "td", name: "Design", secondary: "design" },
];

test("the menu opens only on an unfinished @ fragment", () => {
  expect(mentionQuery("hi @bo")).toBe("bo");
  expect(mentionQuery("@")).toBe("");
  expect(mentionQuery("hi @Bob Stone ")).toBeNull();
  expect(mentionQuery("mail me at a@b")).toBeNull();
});

test("the legacy profile API remains compatible", () => {
  expect(mentionCandidates("hi @b", people).map((p) => p.id)).toEqual(["pb", "pc"]);
  expect(mentionCandidates("hi @bea", people).map((p) => p.id)).toEqual(["pc"]);
  expect(insertMention("hi @bo", bob)).toBe("hi @Bob Stone ");
  expect(survivingMentions("hi @Bob Stone", ["pb", "pc"], people)).toEqual(["pb"]);
  expect(survivingMentions("hi @bob", ["pb"], people)).toEqual(["pb"]);
});

test("typed candidates put profiles before teams and apply the combined limit", () => {
  expect(mentionCandidates("hi @", targets).map((p) => [p.kind, p.id])).toEqual([["profile", "pb"], ["profile", "pc"], ["team", "td"]]);
  expect(mentionCandidates("hi @d", targets).map((p) => p.id)).toEqual(["td"]);
  expect(mentionCandidates("hi @", targets, 2).map((p) => p.id)).toEqual(["pb", "pc"]);
  expect(mentionCandidates("hi @", targets, 0)).toEqual([]);
  expect(insertMention("@de", targets[2])).toBe("@Design ");
});

test("typed edit reconciliation removes a deleted team mention", () => {
  const mentions = [{ kind: "profile" as const, id: "pb" }, { kind: "team" as const, id: "td" }];
  expect(survivingMentions("hi @Bob Stone and @Design", mentions, targets)).toEqual(mentions);
  expect(survivingMentions("hi @Bob Stone", mentions, targets)).toEqual([{ kind: "profile", id: "pb" }]);
  expect(survivingMentions("hi @Design", mentions, targets)).toEqual([{ kind: "team", id: "td" }]);
  expect(survivingMentions("nobody now", [{ kind: "team", id: "td" }], targets)).toEqual([]);
});
