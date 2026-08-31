import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import ProjectSettings from "./ProjectSettings";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { reloadProfiles, reloadProjects, setProfileId, setProjectId } from "../session";

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let dispose: (() => void) | undefined;
const project = { id: "p1", name: "Atlas", key: "ATL", description: null, created_by: "owner", archived: false, deadline: null, lead_id: null as string | null };

// Per-test stubs: a command name maps to a thrower (denial) or a fixed payload, so a suite can
// model "the server refuses this write" without a second mount helper.
const overrides = new Map<string, () => unknown>();
let roleAssignments: Record<string, unknown>[] = [];

const reply = (cmd: string) => {
  const override = overrides.get(cmd);
  if (override) return override();
  if (cmd === "list_role_assignments") return roleAssignments;
  if (cmd === "list_projects") return [project];
  if (cmd === "list_profiles") return [
    { id: "owner", username: "owner", display_name: "Owner", email: null, archived: false },
    { id: "member", username: "member", display_name: "Member", email: null, archived: false },
  ];
  if (cmd === "list_project_member_ids") return ["owner", "member"];
  if (cmd === "set_project_lead") return project;
  if (cmd === "list_roles") return [
    { id: "role-manager", name: "Manager", description: null, parent_id: null, role_type: "CUSTOM", archived: false },
    { id: "role-lead", name: "Lead", description: null, parent_id: null, role_type: "CUSTOM", archived: false },
  ];
  if (cmd === "list_cf_definitions") return [];
  return null;
};

const settle = () => new Promise(resolve => setTimeout(resolve, 50));
const mount = async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, args }); return Promise.resolve(reply(cmd)); } };
  registerViews(["Projects", "Project Settings"]); setAvailableViews(null); initRouter(createMemoryAdapter());
  // Session caches are process-global across test files: seed them from THIS file's
  // stub, or a neighbouring suite's profiles decide who this project's members are.
  setProfileId("owner"); setProjectId("p1"); await reloadProjects(); await reloadProfiles(); navigate({ view: "Project Settings", projectId: "p1" });
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <ProjectSettings /> as any, host);
  await settle();
  return host;
};

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); setProjectId(""); overrides.clear(); roleAssignments = []; });

const existingAssignment = { id: "assign-1", role_id: "role-manager", profile_id: "member", scope_type: "project", scope_id: "p1", granted_by: null, created_at: null };

describe("project settings", () => {
  test("assigns a project-scoped role to a member", async () => {
    const host = await mount();
    const role = host.querySelector<HTMLSelectElement>("#project-role-owner")!;
    role.value = "role-manager"; role.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(calls.find(call => call.cmd === "create_role_assignment")?.args).toMatchObject({ input: { role_id: "role-manager", profile_id: "owner", scope_type: "project", scope_id: "p1" } });
  });

  test("changing a member's role creates the new grant, drops the old one and refetches", async () => {
    roleAssignments = [existingAssignment];
    const host = await mount();
    const role = host.querySelector<HTMLSelectElement>("#project-role-member")!;
    expect(role.value).toBe("role-manager");
    role.value = ""; role.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(calls.find(call => call.cmd === "delete_role_assignment")?.args).toMatchObject({ id: "assign-1" });
    // the list is re-read after the write, so the row reflects the server, not local guessing
    expect(calls.filter(call => call.cmd === "list_role_assignments").length).toBeGreaterThan(1);
  });

  test("assigning a role to a member passes the project scope and refetches", async () => {
    const host = await mount();
    const role = host.querySelector<HTMLSelectElement>("#project-role-member")!;
    role.value = "role-manager"; role.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(calls.find(call => call.cmd === "create_role_assignment")?.args).toMatchObject({ input: { role_id: "role-manager", profile_id: "member", scope_type: "project", scope_id: "p1" } });
    expect(calls.filter(call => call.cmd === "list_role_assignments").length).toBeGreaterThan(1);
  });

  // Data loss guard: a denied create must never cost the member the role they already had.
  test("a denied role change keeps the previous assignment and explains the refusal", async () => {
    roleAssignments = [existingAssignment];
    overrides.set("create_role_assignment", () => { throw new Error("permission denied: manage_project_roles"); });
    const host = await mount();
    const role = host.querySelector<HTMLSelectElement>("#project-role-member")!;
    role.value = "role-lead"; role.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(calls.some(call => call.cmd === "delete_role_assignment")).toBe(false);
    expect(host.querySelector(".ps-error")?.textContent).toContain("permission denied");
    expect(host.querySelector<HTMLSelectElement>("#project-role-member")!.value).toBe("role-manager");
  });

  test("without manage rights the role is read-only, not a select", async () => {
    project.created_by = "somebody-else";
    roleAssignments = [existingAssignment];
    try {
      const host = await mount();
      expect(host.querySelector("#project-role-member")).toBeNull();
      // row order follows list_project_member_ids: owner first (no grant), then member
      expect(Array.from(host.querySelectorAll(".ps-role-readonly")).map(node => node.textContent)).toEqual(["Member", "Manager"]);
    } finally { project.created_by = "owner"; }
  });

  // master's requirement (f4ac0c9), adapted to our fixture: profiles and member ids
  // resolve AFTER the select mounts, so a project that already has a lead must not be
  // rendered as "No lead".
  test("reapplies an existing lead after asynchronous options load", async () => {
    project.lead_id = "member";
    try {
      const host = await mount();
      expect(host.querySelector<HTMLSelectElement>('select[aria-label="Project lead"]')?.value).toBe("member");
    } finally { project.lead_id = null; }
  });

  // The lead is informational; the ONLY thing it restricts is who may write the field.
  test("lead select saves the chosen member through set_project_lead", async () => {
    const host = await mount();
    const lead = host.querySelector<HTMLSelectElement>('select[aria-label="Project lead"]')!;
    expect(Array.from(lead.options).map(option => option.value)).toEqual(["", "owner", "member"]);
    expect(lead.value).toBe("");
    lead.value = "member"; lead.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(calls.find(call => call.cmd === "set_project_lead")?.args).toMatchObject({ projectId: "p1", leadId: "member" });
  });

  test("\"No lead\" clears the field with null", async () => {
    project.lead_id = "member";
    try {
      const host = await mount();
      const lead = host.querySelector<HTMLSelectElement>('select[aria-label="Project lead"]')!;
      expect(lead.value).toBe("member");
      lead.value = ""; lead.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
      expect(calls.find(call => call.cmd === "set_project_lead")?.args.leadId).toBeNull();
    } finally { project.lead_id = null; }
  });

  test("a non-owner cannot edit the lead, but is only told so", async () => {
    project.created_by = "somebody-else";
    try {
      const host = await mount();
      expect(host.querySelector<HTMLSelectElement>('select[aria-label="Project lead"]')!.disabled).toBe(true);
      expect(host.querySelector(".ps-notice")?.textContent).toContain("project owner");
    } finally { project.created_by = "owner"; }
  });

  test("creates custom fields in this project's issue tracker", async () => {
    const host = await mount();
    const [name] = Array.from(host.querySelectorAll<HTMLInputElement>(".ps-field-form input"));
    name.value = "Customer impact"; name.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector<HTMLFormElement>(".ps-field-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.find(call => call.cmd === "create_cf_definition")?.args).toMatchObject({ input: { entity_type: "issue:p1", cf_type: "text", name: "Customer impact" } });
  });
});
