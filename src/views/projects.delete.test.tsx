import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Projects from "./Projects";
import ProjectWorkspace from "./ProjectWorkspace";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { reloadProjects, setProfileId, setProjectId } from "../session";

/** ── DELETING A PROJECT ─────────────────────────────────────────────────────
 *
 *  Two doors, one rule and one question:
 *    · the workspace header (where the project's facts are) — a red button, at rest;
 *    · the portfolio card's right-click menu (where people point at a project).
 *
 *  THE RULE IS `created_by`. A non-owner gets NOTHING — not a disabled button and not
 *  a greyed menu entry, because an act that refuses on click is a rule nobody can read.
 *  Neither door deletes: both open ConfirmDialog, and only "Delete project" there
 *  sends a command. Cancelling is not "a delete that failed" — it is no command at all.
 */

const projects = [
  { id: "p-mine", name: "Atlas", key: "ATL", description: null, created_by: "me", archived: false, deadline: null, lead_id: null },
  { id: "p-theirs", name: "Borealis", key: "BOR", description: null, created_by: "other", archived: false, deadline: null, lead_id: null },
];
const profiles = [
  { id: "me", username: "me", display_name: "Me", email: null, archived: false },
  { id: "other", username: "other", display_name: "Other Person", email: null, archived: false },
];

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let deleteFails = "";
let dispose: (() => void) | undefined;

const reply = (cmd: string) => {
  if (cmd === "list_projects") return projects;
  if (cmd === "list_profiles") return profiles;
  if (cmd === "project_dashboard_aggregate") return { project_id: "p-mine", open_issues: 0, open_todos: 0, member_count: 1, deadline: null };
  return [];
};

const settle = () => new Promise(resolve => setTimeout(resolve, 60));
const mount = async (component: () => unknown) => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args: args ?? {} });
      if (cmd === "delete_project" && deleteFails) return Promise.reject(new Error(deleteFails));
      return Promise.resolve(reply(cmd));
    },
  };
  registerViews(["Projects", "Project Workspace", "Project Settings", "Issues"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter());
  await reloadProjects();
  setProfileId("me");
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(component as any, host);
  await settle();
  return host;
};

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0; deleteFails = "";
  delete (window as any).__TAURI_INTERNALS__;
  setProfileId(""); setProjectId("");
});

const cardOf = (host: HTMLElement, name: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(".project-card"))
    .find(card => card.querySelector(".project-card-head strong")?.textContent === name)!;
const rightClick = (element: HTMLElement) =>
  element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }));
const menuEntries = () => Array.from(document.querySelectorAll<HTMLElement>(".context-menu .context-item")).map(item => item.textContent);
const menuEntry = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".context-menu button.context-item")).find(item => item.textContent === label);
const deleteCalls = () => calls.filter(call => call.cmd === "delete_project");

describe("the project list: right-click is the second door", () => {
  // THE CARD HAS NO FOOTER, so the acts on a listed project are all in this one menu:
  // the way in first, then the reversible acts, then the irreversible one, last and red.
  test("the owner's card offers the way in, the acts, and Delete last", async () => {
    const host = await mount(() => <Projects /> as any);
    rightClick(cardOf(host, "Atlas"));
    await settle();
    expect(menuEntries()).toEqual(["Open", "Set deadline…", "Archive", "Delete project…"]);
    expect(menuEntry("Delete project…")?.classList.contains("danger")).toBe(true);
  });

  test("somebody else's card offers no delete and no deadline — not a disabled one", async () => {
    const host = await mount(() => <Projects /> as any);
    rightClick(cardOf(host, "Borealis"));
    await settle();
    expect(menuEntries()).toEqual(["Open", "Archive"]);
    expect(document.querySelector(".context-item.disabled")).toBeNull();
  });

  test("the menu asks; cancelling sends nothing at all", async () => {
    const host = await mount(() => <Projects /> as any);
    rightClick(cardOf(host, "Atlas"));
    await settle();
    menuEntry("Delete project…")!.click();
    await settle();
    // Choosing the destructive entry has still deleted NOTHING: it opened the question.
    expect(deleteCalls()).toHaveLength(0);
    const dialog = document.querySelector(".confirm-root")!;
    expect(dialog.querySelector(".confirm-body")?.textContent).toContain("Atlas");
    (dialog.querySelector(".confirm-cancel") as HTMLButtonElement).click();
    await settle();
    expect(deleteCalls()).toHaveLength(0);
    expect(document.querySelector(".confirm-root")).toBeNull();
  });

  test("confirming sends exactly one delete_project, with the id and the actor", async () => {
    const host = await mount(() => <Projects /> as any);
    rightClick(cardOf(host, "Atlas"));
    await settle();
    menuEntry("Delete project…")!.click();
    await settle();
    (document.querySelector(".confirm-danger") as HTMLButtonElement).click();
    await settle();
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0].args).toEqual({ id: "p-mine", actorId: "me" });
  });

  test("a refused delete is SHOWN, never swallowed", async () => {
    deleteFails = "project delete is not available yet";
    const host = await mount(() => <Projects /> as any);
    rightClick(cardOf(host, "Atlas"));
    await settle();
    menuEntry("Delete project…")!.click();
    await settle();
    (document.querySelector(".confirm-danger") as HTMLButtonElement).click();
    await settle();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("project delete is not available yet");
  });
});

describe("the project workspace header: the owner's red button", () => {
  const mountWorkspace = async (projectId: string) => {
    const host = await mount(() => <ProjectWorkspace /> as any);
    navigate({ view: "Project Workspace", projectId });
    await settle();
    return host;
  };

  test("the owner sees Delete beside the project's facts", async () => {
    const host = await mountWorkspace("p-mine");
    const button = host.querySelector<HTMLButtonElement>(".pw-header-actions .delete-button");
    expect(button).toBeTruthy();
    expect(button!.getAttribute("aria-label")).toBe("Delete project");
  });

  test("a non-owner sees NO button — not a disabled one", async () => {
    const host = await mountWorkspace("p-theirs");
    expect(host.querySelector(".pw-header-actions .delete-button")).toBeNull();
    expect(host.querySelector(".pw-header-actions button[disabled]")).toBeNull();
  });

  test("the button asks, and confirming sends one delete_project with the actor", async () => {
    const host = await mountWorkspace("p-mine");
    host.querySelector<HTMLButtonElement>(".pw-header-actions .delete-button")!.click();
    await settle();
    expect(deleteCalls()).toHaveLength(0);
    expect(document.querySelector(".confirm-body")?.textContent).toContain("Atlas");
    (document.querySelector(".confirm-danger") as HTMLButtonElement).click();
    await settle();
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0].args).toEqual({ id: "p-mine", actorId: "me" });
  });

  test("cancelling in the header deletes nothing", async () => {
    const host = await mountWorkspace("p-mine");
    host.querySelector<HTMLButtonElement>(".pw-header-actions .delete-button")!.click();
    await settle();
    (document.querySelector(".confirm-cancel") as HTMLButtonElement).click();
    await settle();
    expect(deleteCalls()).toHaveLength(0);
  });

  test("a refused delete reaches the screen in the header's own error line", async () => {
    deleteFails = "delete_project not found";
    const host = await mountWorkspace("p-mine");
    host.querySelector<HTMLButtonElement>(".pw-header-actions .delete-button")!.click();
    await settle();
    (document.querySelector(".confirm-danger") as HTMLButtonElement).click();
    await settle();
    expect(host.querySelector(".pw-error")?.textContent).toContain("delete_project not found");
  });
});
