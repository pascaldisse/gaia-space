import { afterEach, describe, expect, test } from "bun:test";
import { render } from "solid-js/web";
import ProjectSettings from "./ProjectSettings";
import { createMemoryAdapter, initRouter, registerViews, setAvailableViews } from "../router";
import { reloadProjects, setProfileId, setProjectId } from "../session";

let dispose: (() => void) | undefined;
let calls: { cmd: string; args: Record<string, unknown> }[] = [];
const project = { id: "p1", name: "Atlas", key: "ATL", description: "Launch work", created_by: "owner", archived: false, deadline: "2030-06-01" };
const settle = () => new Promise(done => setTimeout(done, 45));
const serve = () => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      switch (cmd) {
        case "list_projects": return Promise.resolve([project]);
        case "list_profiles": return Promise.resolve([
          { id: "owner", username: "owner", display_name: "Owner", email: null, archived: false },
          { id: "member", username: "member", display_name: "Member", email: null, archived: false },
        ]);
        case "list_project_member_ids": return Promise.resolve(["owner"]);
        case "list_roles": return Promise.resolve([{ id: "lead", name: "Project lead", description: null, parent_id: null, role_type: "custom", archived: false }]);
        case "list_role_assignments": return Promise.resolve([]);
        case "cf_get_values": return Promise.resolve([]);
        case "add_project_member": return Promise.resolve(["owner", "member"]);
        case "create_role_assignment": return Promise.resolve({ id: "assignment", role_id: "lead", profile_id: "member", team_id: null, scope_type: "project", scope_id: "p1" });
        case "create_cf_definition": return Promise.resolve({ id: "cf1" });
        case "update_project": return Promise.resolve();
        default: return Promise.resolve();
      }
    },
  };
};
afterEach(() => {
  dispose?.(); dispose = undefined; calls = []; document.body.innerHTML = "";
  delete (window as any).__TAURI_INTERNALS__;
  setProfileId(""); setProjectId("");
});

describe("project settings", () => {
  test("owners manage project members, scoped roles, and typed field definitions", async () => {
    serve(); setProfileId("owner"); setProjectId("p1");
    registerViews(["Projects", "Project Settings"]); setAvailableViews(null); initRouter(createMemoryAdapter("projects/p1/settings"));
    await reloadProjects();
    const host = document.createElement("div"); document.body.appendChild(host);
    dispose = render(() => <ProjectSettings />, host); await settle();
    expect(host.textContent).toContain("Members and project roles");
    expect(host.textContent).toContain("Custom fields");
    const selects = [...host.querySelectorAll("select")];
    const person = selects.find(select => select.getAttribute("aria-label") === "Project member")!;
    person.value = "member"; person.dispatchEvent(new Event("change", { bubbles: true }));
    const role = selects.find(select => select.getAttribute("aria-label") === "Initial project role")!;
    role.value = "lead"; role.dispatchEvent(new Event("change", { bubbles: true }));
    [...host.querySelectorAll("button")].find(button => button.textContent === "Add member")!.click(); await settle();
    expect(calls.find(call => call.cmd === "add_project_member")?.args).toMatchObject({ projectId: "p1", memberId: "member" });
    expect(calls.find(call => call.cmd === "create_role_assignment")?.args).toMatchObject({ input: { role_id: "lead", profile_id: "member", scope_type: "project", scope_id: "p1" } });
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Custom field name"]')!;
    field.value = "Cost center"; field.dispatchEvent(new Event("input", { bubbles: true }));
    [...host.querySelectorAll("button")].find(button => button.textContent === "Add field")!.click(); await settle();
    expect(calls.find(call => call.cmd === "create_cf_definition")?.args).toMatchObject({ input: { entity_type: "project", cf_type: "text", name: "Cost center" } });
  });
});
