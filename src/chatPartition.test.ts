import { describe, expect, test } from "bun:test";
import { DIRECT_FALLBACK_LABEL, chatHeaderLabel, dmLabel, isDirectMessage, participantCount, partitionChannels } from "./chatPartition";
import type { PartitionableChannel } from "./chatPartition";

const channel = (over: Partial<PartitionableChannel> & { id: string }): PartitionableChannel => ({
  name: null,
  content_type: "public",
  ...over,
});

const NAMES: Record<string, string> = { me: "Jannes", them: "Bjarne", third: "Ada" };
const nameOf = (id: string) => NAMES[id];

describe("isDirectMessage", () => {
  test("a two-person dm is direct, named or not", () => {
    expect(isDirectMessage(channel({ id: "a", content_type: "dm", member_count: 2 }))).toBe(true);
    expect(isDirectMessage(channel({ id: "b", content_type: "dm", name: "Bjarne \u00b7 Jannes", member_count: 2 }))).toBe(true);
  });

  test("three or more people is a channel even when the row says dm", () => {
    expect(isDirectMessage(channel({ id: "c", content_type: "dm", member_count: 3 }))).toBe(false);
    expect(isDirectMessage(channel({ id: "c", content_type: "dm" }), () => ["me", "them", "third"])).toBe(false);
  });

  test("a two-person private channel is not a dm", () => {
    expect(isDirectMessage(channel({ id: "d", content_type: "private", name: "secrets", member_count: 2 }))).toBe(false);
  });

  test("membership wins over a stale member_count", () => {
    const row = channel({ id: "e", content_type: "dm", member_count: 9 });
    expect(isDirectMessage(row, () => ["me", "them"])).toBe(true);
  });

  test("duplicate member rows do not inflate the head count", () => {
    expect(participantCount(channel({ id: "f", content_type: "dm" }), () => ["me", "me", "them"])).toBe(2);
  });
});

describe("dmLabel", () => {
  test("names the other member and excludes me", () => {
    const row = channel({ id: "a", content_type: "dm", name: "Bjarne \u00b7 Jannes" });
    expect(dmLabel(row, "me", { members: () => ["me", "them"], nameOf })).toBe("Bjarne");
  });

  test("without membership, drops my own name out of the stored label", () => {
    const row = channel({ id: "a", content_type: "dm", name: "Bjarne \u00b7 Jannes" });
    expect(dmLabel(row, "me", { nameOf })).toBe("Bjarne");
  });

  test("a note to self keeps my own name rather than emptying out", () => {
    const row = channel({ id: "a", content_type: "dm", name: "Jannes" });
    expect(dmLabel(row, "me", { members: () => ["me"], nameOf })).toBe("Jannes");
  });

  test("falls back to the honest placeholder when nothing names the other side", () => {
    expect(dmLabel(channel({ id: "a", content_type: "dm" }), "me", { nameOf })).toBe(DIRECT_FALLBACK_LABEL);
  });

  test("an unknown profile id is shown rather than invented", () => {
    const row = channel({ id: "a", content_type: "dm" });
    expect(dmLabel(row, "me", { members: () => ["me", "ghost"], nameOf })).toBe("ghost");
  });
});

describe("partitionChannels", () => {
  const rows = [
    channel({ id: "general", content_type: "public", name: "general" }),
    channel({ id: "dm1", content_type: "dm", name: "Bjarne \u00b7 Jannes", member_count: 2 }),
    channel({ id: "trio", content_type: "dm", name: "Ada \u00b7 Bjarne \u00b7 Jannes", member_count: 3 }),
    channel({ id: "secrets", content_type: "private", name: "secrets", member_count: 2 }),
  ];

  test("named dms leave the channel sections", () => {
    const { channels, dms } = partitionChannels(rows, "me");
    expect(dms.map((row) => row.id)).toEqual(["dm1"]);
    expect(channels.map((row) => row.id)).toEqual(["general", "trio", "secrets"]);
  });

  test("input order survives inside each section", () => {
    const { channels } = partitionChannels([...rows].reverse(), "me");
    expect(channels.map((row) => row.id)).toEqual(["secrets", "trio", "general"]);
  });

  test("an empty list yields two empty sections", () => {
    expect(partitionChannels([], "me")).toEqual({ channels: [], dms: [] });
  });
});


describe("chatHeaderLabel", () => {
  test("a named direct message header names only the other person", () => {
    const row = channel({ id: "a", content_type: "dm", name: "Bjarne · Jannes", member_count: 2 });
    expect(chatHeaderLabel(row, "me", { nameOf })).toBe("Bjarne");
  });
});
