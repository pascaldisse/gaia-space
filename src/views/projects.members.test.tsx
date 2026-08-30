import { expect, test, describe, afterEach, beforeEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Projects, { FALLBACK_KEY, uniqueKey } from "./Projects";
import { reloadProfiles, setProfileId, setProjectId } from "../session";

/** WHO IS ON A PROJECT IS DECIDED WHEN THE PROJECT IS DECIDED.
 *  The creator is a member by creating it, so they are never offered. Everybody else
 *  is chosen the way a meeting's participants are: a menu, a pill per person, × to
 *  take them off. Membership can only be written AFTER create_project mints the id —
 *  and a refused membership must never be reported as a failed creation. */

const calls: { cmd: string; args: any }[] = [];
const realFetch = globalThis.fetch;

const PROFILES = [
  { id: "p-me", username: "creator", display_name: "Creator Carla", archived: false },
  { id: "p-ada", username: "ada", display_name: "Ada Lovelace", archived: false },
  { id: "p-bob", username: "bob", display_name: "Bob Builder", archived: false },
  { id: "p-old", username: "old", display_name: "Archived Alf", archived: true },
];
const ROLES = [
  { id: "r-dev", name: "Developer", description: null, parent_id: null, role_type: "project", archived: false },
  { id: "r-gone", name: "Retired", description: null, parent_id: null, role_type: "project", archived: true },
];

/** One transport for the whole test: the desktop IPC hook, so no session identity
 *  interferes with "who is the creator". `fail` names a command that must refuse. */
/** What `list_projects` answers — the keys already taken, for the derivation test. */
let listedProjects: any[] = [];
const stubIpc = (roles: unknown[] = ROLES, fail?: (cmd: string, args: any) => string | null) => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: any) => {
      calls.push({ cmd, args });
      const refusal = fail?.(cmd, args);
      if (refusal) return Promise.reject(new Error(refusal));
      if (cmd === "list_profiles") return Promise.resolve(PROFILES);
      if (cmd === "list_projects") return Promise.resolve(listedProjects);
      if (cmd === "list_roles") return Promise.resolve(roles);
      if (cmd === "add_project_member") return Promise.resolve([args.memberId]);
      return Promise.resolve([]);
    },
  };
};

const settle = () => new Promise((done) => setTimeout(done, 40));
let dispose: (() => void) | undefined;
let host: HTMLDivElement;

beforeEach(() => { setProfileId("p-me"); });
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0; listedProjects = [];
  globalThis.fetch = realFetch;
  delete (window as any).__TAURI_INTERNALS__;
  setProjectId(""); setProfileId("");
});

const openDrawer = async () => {
  // The profile list is process-global session state: another suite may already have
  // filled it. Load THIS suite's people through the stub before rendering, or the view
  // reads somebody else's workspace.
  await reloadProfiles();
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Projects /> as any, host);
  await settle();
  const open = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "New project")!;
  open.click();
  await settle();
};

const memberMenu = () => host.querySelector<HTMLButtonElement>('button[aria-label="Add project member"]')!;
const menuOptions = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((o) => o.textContent ?? "");
const pickOption = async (text: string) => {
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => (o.textContent ?? "").includes(text))!;
  expect(option).toBeTruthy();
  // PillMenu commits on mousedown (it keeps the focus story its own), not on click.
  option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await settle();
};
const fillAndSubmit = async () => {
  const [name] = Array.from(host.querySelectorAll<HTMLInputElement>(".project-form input"));
  name.value = "Members project"; name.dispatchEvent(new Event("input", { bubbles: true }));
  host.querySelector("form.project-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
};

describe("derived project key", () => {
  test("two projects of the same name never share a key", () => {
    const first = uniqueKey("Orbital", []);
    const second = uniqueKey("Orbital", [first]);
    const third = uniqueKey("Orbital", [first, second]);
    expect([first, second, third]).toEqual(["ORBIT", "ORBIT2", "ORBIT3"]);
    expect(new Set([first, second, third]).size).toBe(3);
  });
  test("a taken key is recognised whatever its case, and a nameless key still exists", () => {
    expect(uniqueKey("Orbital", ["orbit"])).toBe("ORBIT2");
    expect(uniqueKey("日本語", [])).toBe(FALLBACK_KEY);
  });
});

describe("new project: members and roles", () => {
  test("the creator is not offered — they are in the project by creating it", async () => {
    stubIpc();
    await openDrawer();
    memberMenu().click();
    await settle();
    const labels = menuOptions();
    expect(labels.some((l) => l.includes("Ada Lovelace"))).toBe(true);
    expect(labels.some((l) => l.includes("Creator Carla"))).toBe(false);
    // Archived profiles are gone from the product; they are not offered either.
    expect(labels.some((l) => l.includes("Archived Alf"))).toBe(false);
  });

  test("a chosen person stands as a pill and leaves again through ×", async () => {
    stubIpc();
    await openDrawer();
    memberMenu().click(); await settle();
    await pickOption("Ada Lovelace");
    expect(host.querySelectorAll(".project-member").length).toBe(1);
    expect(host.querySelector(".project-member-name")?.textContent).toBe("Ada Lovelace");
    host.querySelector<HTMLButtonElement>('button[aria-label="Remove Ada Lovelace"]')!.click();
    await settle();
    expect(host.querySelectorAll(".project-member").length).toBe(0);
  });

  test("no roles in the workspace: no role menu, and no invented role", async () => {
    stubIpc([]);
    await openDrawer();
    memberMenu().click(); await settle();
    await pickOption("Ada Lovelace");
    expect(host.querySelector('button[aria-label="Role for Ada Lovelace"]')).toBeNull();
  });

  test("creating writes create_project first, then one add_project_member per person, then the role", async () => {
    stubIpc();
    await openDrawer();
    memberMenu().click(); await settle();
    await pickOption("Ada Lovelace");
    memberMenu().click(); await settle();
    await pickOption("Bob Builder");
    // A role for Ada only; an archived role is never offered.
    host.querySelector<HTMLButtonElement>('button[aria-label="Role for Ada Lovelace"]')!.click();
    await settle();
    expect(menuOptions().some((l) => l.includes("Retired"))).toBe(false);
    await pickOption("Developer");
    await fillAndSubmit();

    const order = calls.map((c) => c.cmd).filter((c) => ["create_project", "add_project_member", "create_role_assignment"].includes(c));
    expect(order).toEqual(["create_project", "add_project_member", "create_role_assignment", "add_project_member"]);
    const added = calls.filter((c) => c.cmd === "add_project_member");
    const projectId = calls.find((c) => c.cmd === "create_project")!.args.project.id;
    expect(added.map((c) => c.args.memberId)).toEqual(["p-ada", "p-bob"]);
    expect(added.every((c) => c.args.projectId === projectId)).toBe(true);
    const assignment = calls.find((c) => c.cmd === "create_role_assignment")!.args.input;
    expect(assignment).toMatchObject({ role_id: "r-dev", profile_id: "p-ada", scope_type: "project", scope_id: projectId });
  });

  test("no key is asked for: it is derived from the name, and never collides", async () => {
    stubIpc();
    // One project already carries the derived key, and its numbered successor too.
    listedProjects = [
      { id: "p1", name: "Members project", key: "MEMBE", description: null, created_by: "p-me", archived: false, deadline: null, lead_id: null },
      { id: "p2", name: "Members project", key: "MEMBE2", description: null, created_by: "p-me", archived: false, deadline: null, lead_id: null },
    ];
    await openDrawer();
    // The drawer asks for name, description — and no key.
    expect(host.querySelector('input[aria-label="Project key"]')).toBeNull();
    await fillAndSubmit();
    const created = calls.find((c) => c.cmd === "create_project")!.args.project;
    expect(created.key).toBe("MEMBE3");
    // And the card stops printing it.
    expect(host.querySelector(".project-card-head code")).toBeNull();
  });

  test("a refused membership is said out loud and the project still exists", async () => {
    stubIpc(ROLES, (cmd) => (cmd === "add_project_member" ? "Not allowed to add members" : null));
    await openDrawer();
    memberMenu().click(); await settle();
    await pickOption("Ada Lovelace");
    await fillAndSubmit();

    expect(calls.filter((c) => c.cmd === "create_project").length).toBe(1);
    const error = document.querySelector('[role="alert"]')?.textContent ?? "";
    expect(error).toContain("Project created");
    expect(error).toContain("Ada Lovelace");
    expect(error).toContain("Not allowed to add members");
  });
});
