import { describe, expect, it } from "bun:test";
import { applyCommand, mapWithLimit, mergeCommandListings, slashPrefix } from "./chatCommands";
import type { CommandListing } from "./api/applications";

const listing = (over: Partial<CommandListing>): CommandListing => ({
  chatbot_id: "bot-1",
  application_id: "app-1",
  commands: [],
  source: "app",
  error: null,
  ...over,
});

describe("slash command discovery", () => {
  it("opens only on a leading slash that is still one word", () => {
    expect(slashPrefix("/")).toBe("");
    expect(slashPrefix("/dep")).toBe("dep");
    expect(slashPrefix("/deploy now")).toBeNull();
    expect(slashPrefix("see http://x/y")).toBeNull();
    expect(slashPrefix("and/or")).toBeNull();
    expect(slashPrefix("")).toBeNull();
  });

  it("keeps same-named commands from different bots apart", () => {
    const entries = mergeCommandListings([
      {
        listing: listing({ chatbot_id: "bot-a", commands: [{ name: "deploy", description: "A" }] }),
        bot_name: "Alpha",
      },
      {
        listing: listing({ chatbot_id: "bot-b", commands: [{ name: "deploy", description: "B" }] }),
        bot_name: "Beta",
      },
    ]);
    expect(entries.map((e) => [e.bot_name, e.description])).toEqual([
      ["Alpha", "A"],
      ["Beta", "B"],
    ]);
  });

  it("prefers a bot's live answer over its own declared fallback", () => {
    const entries = mergeCommandListings([
      {
        listing: listing({ commands: [{ name: "ping", description: "live" }], source: "app" }),
        bot_name: "Alpha",
      },
      {
        listing: listing({
          commands: [{ name: "ping", description: "declared" }],
          source: "registration",
          error: "endpoint down",
        }),
        bot_name: "Alpha",
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe("live");
    expect(entries[0].source).toBe("app");
  });

  it("completes the draft with a trailing space so arguments can follow", () => {
    expect(applyCommand("deploy")).toBe("/deploy ");
  });

  it("never has more than the limit in flight and stops when superseded", async () => {
    let inFlight = 0;
    let peak = 0;
    let started = 0;
    const bots = Array.from({ length: 12 }, (_, i) => i);
    const results = await mapWithLimit(bots, 4, async (bot) => {
      started++;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return bot;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(results).toHaveLength(12);
    expect(started).toBe(12);

    let cancelledAfter = 0;
    const partial = await mapWithLimit(
      bots,
      2,
      async (bot) => {
        cancelledAfter++;
        return bot;
      },
      () => cancelledAfter >= 3,
    );
    expect(cancelledAfter).toBeLessThan(12);
    expect(partial.length).toBeLessThan(12);
  });

  it("keeps an undefined answer in its place instead of dropping it", async () => {
    const kept = await mapWithLimit([1, 2, 3], 2, async (n) =>
      n === 2 ? undefined : n,
    );
    expect(kept).toEqual([1, undefined, 3]);
  });

  it("stops calling out once one call has failed", async () => {
    let calls = 0;
    const attempt = mapWithLimit(Array.from({ length: 20 }, (_, i) => i), 2, async (n) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (n === 0) throw new Error("endpoint down");
      return n;
    });
    await expect(attempt).rejects.toThrow("endpoint down");
    const seenAtFailure = calls;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBeLessThanOrEqual(seenAtFailure + 1);
    expect(calls).toBeLessThan(20);
  });
});
