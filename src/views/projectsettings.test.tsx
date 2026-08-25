import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import ProjectSettings from "./ProjectSettings";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { reloadProjects, setProfileId, setProjectId } from "../session";

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let dispose: (() => void) | undefined;
const project = { id: "p1", name: "Atlas", key: "ATL", description: null, created_by: "owner", archived: false, deadline: null, lead_id: "member" };

const reply = (cmd: string) => {
  if (cmd === "list_projects") return [project];
  if (cmd === "list_profiles") return [
    { id: "owner", username: "owner", display_name: "Owner", email: null, archived: false },
    { id: "member", username: "member", display_name: "Member", email: null, archived: false },
  ];
  if (cmd === "list_project_member_ids") return ["owner", "member"];
  if (cmd === "list_roles") return [{ id: "role-manager", name: "Manager", description: null, parent_id: null, role_type: "CUSTOM", archived: false }];
  if (cmd === "list_role_assignments" || cmd === "list_cf_definitions") return [];
  return null;
};

const settle = () => new Promise(resolve => setTimeout(resolve, 50));
const mount = async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, args }); return Promise.resolve(reply(cmd)); } };
  registerViews(["Projects", "Project Settings"]); setAvailableViews(null); initRouter(createMemoryAdapter());
  setProfileId("owner"); setProjectId("p1"); await reloadProjects(); navigate({ view: "Project Settings", projectId: "p1" });
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <ProjectSettings /> as any, host);
  await settle();
  return host;
};

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); setProjectId(""); });

describe("project settings", () => {
  test("assigns a project-scoped role to a member", async () => {
    const host = await mount();
    const role = host.querySelector<HTMLSelectElement>("#project-role-owner")!;
    role.value = "role-manager"; role.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(calls.find(call => call.cmd === "create_role_assignment")?.args).toMatchObject({ input: { role_id: "role-manager", profile_id: "owner", scope_type: "project", scope_id: "p1" } });
  });

  test("reapplies an existing lead after asynchronous options load", async () => {
    const host = await mount();
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Project lead"]')?.value).toBe("member");
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
