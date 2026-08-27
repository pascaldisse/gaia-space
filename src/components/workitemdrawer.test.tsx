import { afterEach, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));

import { render } from "solid-js/web";
import WorkItemDrawer from "./WorkItemDrawer";
import { reloadProfiles, setProfileId } from "../session";

// The law under test: work is born from a message DELIBERATELY, and it keeps its
// origin. So the drawer must (a) write nothing until an explicit submit, (b) put the
// source anchor on whatever it does write, and (c) leave without a trace on Escape.

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let dispose: (() => void) | undefined;
const writes = () => calls.filter(entry => entry.cmd.startsWith("create_") || entry.cmd.startsWith("update_") || entry.cmd.startsWith("set_"));

const reply = (cmd: string) => {
  if (cmd === "resolve_source_ref") return { entity_type: "message", entity_id: "m-1", channel_id: "c-1", channel_name: "video-factory", author_name: "Mia", created_at: 42, excerpt: "Skript prüfen bis Freitag" };
  if (cmd === "list_project_member_ids") return ["me", "other"];
  if (cmd === "list_profiles") return [{ id: "me", username: "me", display_name: "Me", email: null, archived: false }, { id: "other", username: "other", display_name: "Other Person", email: null, archived: false }];
  if (cmd === "create_todo") return { id: "todo-1" };
  return [];
};
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
const mount = async (component: () => unknown) => {
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, args }); return Promise.resolve(reply(cmd)); } };
  setProfileId("me"); await reloadProfiles();
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(component as any, host);
  await settle();
  return host;
};

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); });

const source = { entity_type: "message", entity_id: "m-1", channel_id: "c-1", excerpt: "Skript prüfen bis Freitag" };

test("a task created from a message carries the source anchor and the prefilled-but-edited title", async () => {
  const created: [string, string][] = [];
  const host = await mount(() => <WorkItemDrawer kind="task" source={source} projectId="p1" prefillTitle="Skript prüfen bis Freitag" onClose={() => {}} onCreated={(kind, id) => created.push([kind, id])} /> as any);
  // Opening resolved the source and showed it, but wrote nothing.
  expect(calls.some(entry => entry.cmd === "resolve_source_ref")).toBe(true);
  expect(host.textContent).toContain("video-factory");
  expect(host.textContent).toContain("Skript prüfen bis Freitag");
  expect(writes()).toEqual([]);

  const title = host.querySelector<HTMLInputElement>(".wid-field input.wid-input")!;
  expect(title.value).toBe("Skript prüfen bis Freitag");
  title.value = "Skript final prüfen"; title.dispatchEvent(new Event("input", { bubbles: true }));
  host.querySelector<HTMLFormElement>(".wid-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();

  const write = calls.find(entry => entry.cmd === "create_todo")!;
  const input = write.args.input as Record<string, unknown>;
  expect(input.source_entity_type).toBe("message");
  expect(input.source_entity_id).toBe("m-1");
  expect(input.content).toBe("Skript final prüfen");
  expect(input.project_id).toBe("p1");
  expect(created).toEqual([["task", "todo-1"]]);
});

test("the drawer never creates anything without an explicit submit", async () => {
  const host = await mount(() => <WorkItemDrawer kind="ticket" source={source} projectId="p1" prefillTitle="Safari Login hängt" onClose={() => {}} /> as any);
  // Typing, choosing people, changing priority: all local until the person submits.
  const title = host.querySelector<HTMLInputElement>(".wid-field input.wid-input")!;
  title.value = "Safari Login hängt beim zweiten Versuch"; title.dispatchEvent(new Event("input", { bubbles: true }));
  const owner = host.querySelector<HTMLSelectElement>("select.wid-input")!;
  owner.value = "other"; owner.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  expect(writes()).toEqual([]);
});

test("Escape closes the drawer without writing", async () => {
  let closed = 0;
  await mount(() => <WorkItemDrawer kind="event" source={source} projectId="p1" prefillTitle="Release sync" onClose={() => { closed += 1; }} /> as any);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(closed).toBe(1);
  expect(writes()).toEqual([]);
});

test("assignment is restricted to project members", async () => {
  const host = await mount(() => <WorkItemDrawer kind="task" source={source} projectId="p1" onClose={() => {}} /> as any);
  const options = Array.from(host.querySelectorAll<HTMLOptionElement>("select.wid-input option")).map(node => node.value);
  expect(options).toEqual(["", "me", "other"]);
  expect(calls.some(entry => entry.cmd === "list_project_member_ids" && entry.args.projectId === "p1")).toBe(true);
});
