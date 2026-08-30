import { afterEach, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import SourceLink from "./SourceLink";
import { createMemoryAdapter, initRouter, registerViews, setAvailableViews } from "../router";

// The acceptance criterion this guards: "global tasks and the global calendar show
// sources back into the channel". A stored anchor must become a real, clickable route
// into the originating channel — and a dead anchor must SAY it is dead, not vanish.

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let dispose: (() => void) | undefined;
let resolves = true;

const settle = () => new Promise(resolve => setTimeout(resolve, 40));
const mount = async (component: () => unknown) => {
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd !== "resolve_source_ref") return Promise.resolve([]);
    return resolves
      ? Promise.resolve({ entity_type: "message", entity_id: "m-1", channel_id: "c-1", channel_name: "video-factory", author_name: "Mia", created_at: 42, excerpt: "Skript prüfen bis Freitag" })
      : Promise.reject(new Error("No message found for source anchor m-gone"));
  } };
  registerViews(["Chat", "Tasks", "Calendar"]); setAvailableViews(null); initRouter(createMemoryAdapter());
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(component as any, host);
  await settle();
  return host;
};

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; resolves = true; delete (window as any).__TAURI_INTERNALS__; });

test("a message anchor becomes a real link into its channel", async () => {
  const host = await mount(() => <SourceLink entityType="message" entityId="m-1" /> as any);
  expect(calls.find(entry => entry.cmd === "resolve_source_ref")!.args).toMatchObject({ entityType: "message", entityId: "m-1" });
  const anchor = host.querySelector<HTMLAnchorElement>("a.source-link-anchor")!;
  expect(anchor.getAttribute("href")).toBe("/channel/c-1/messages");
  expect(anchor.textContent).toContain("#video-factory");
  expect(anchor.textContent).toContain("Mia");
  expect(anchor.getAttribute("title")).toBe("Skript prüfen bis Freitag");
});

test("a dead anchor is shown as dead rather than silently dropped", async () => {
  resolves = false;
  const host = await mount(() => <SourceLink entityType="message" entityId="m-gone" /> as any);
  expect(host.querySelector("a.source-link-anchor")).toBeNull();
  expect(host.querySelector(".source-link-dead")!.getAttribute("title")).toBe("message: m-gone");
});
