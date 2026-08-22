import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { platformApi, type CfDefinition, type CfType, type RoleAssignment } from "../api/platform";
import { personalApi } from "../api/personal";
import { currentUser, humanError, isWeb, profileId, profiles, projects, reloadProfiles, reloadProjects, setProjectId } from "../session";
import { navigate, route } from "../router";
import "./ProjectSettings.css";

const CF_TYPES: { value: CfType; label: string; hint: string }[] = [
  { value: "text", label: "Text", hint: "Short text" },
  { value: "int", label: "Number", hint: "Whole number" },
  { value: "date", label: "Date", hint: "Calendar date" },
  { value: "enum", label: "List", hint: "One choice from a list" },
  { value: "profile", label: "Organization member", hint: "A member reference" },
  { value: "bool", label: "Checkbox", hint: "Yes or no" },
];

const nameOf = (id: string) => {
  const profile = profiles()?.find(item => item.id === id);
  return profile?.display_name || profile?.username || id;
};

function ProjectMembers(props: { projectId: string; owner: string | null; canManage: boolean }) {
  const [error, setError] = createSignal("");
  const [memberId, setMemberId] = createSignal("");
  const [busy, setBusy] = createSignal("");
  const [members, { mutate: setMembers, refetch: reloadMembers }] = createResource(
    () => props.projectId,
    id => id ? personalApi.projectMemberIds(id) : Promise.resolve([] as string[]),
  );
  const [roles] = createResource(platformApi.roles);
  const [assignments, { refetch: reloadAssignments }] = createResource(() => true, () => platformApi.assignments());
  if (!profiles()) void reloadProfiles().catch(() => undefined);

  const available = () => (profiles() ?? []).filter(profile => !profile.archived && !(members() ?? []).includes(profile.id));
  const assignmentFor = (member: string) => (assignments() ?? []).find(assignment =>
    assignment.profile_id === member && assignment.scope_type === "project" && assignment.scope_id === props.projectId,
  );
  const assignableRoles = () => (roles() ?? []).filter(role => !role.archived);
  const roleName = (assignment?: RoleAssignment) => assignment ? roles()?.find(role => role.id === assignment.role_id)?.name ?? assignment.role_id : "Member";

  const add = async () => {
    if (!memberId()) return;
    setError(""); setBusy(memberId());
    try { setMembers(await personalApi.addProjectMember(props.projectId, memberId())); setMemberId(""); }
    catch (reason) { setError(humanError(reason)); void reloadMembers(); }
    finally { setBusy(""); }
  };
  const remove = async (member: string) => {
    setError(""); setBusy(member);
    try { setMembers(await personalApi.removeProjectMember(props.projectId, member)); await reloadAssignments(); }
    catch (reason) { setError(humanError(reason)); void reloadMembers(); }
    finally { setBusy(""); }
  };
  const setRole = async (member: string, roleId: string) => {
    const previous = assignmentFor(member);
    if ((previous?.role_id ?? "") === roleId) return;
    setError(""); setBusy(member);
    try {
      if (previous) await platformApi.deleteAssignment(previous.id);
      if (roleId) await platformApi.createAssignment({ role_id: roleId, profile_id: member, scope_type: "project", scope_id: props.projectId });
      await reloadAssignments();
    } catch (reason) { setError(humanError(reason)); await reloadAssignments(); }
    finally { setBusy(""); }
  };

  return <section class="ps-panel ps-panel-wide">
    <div class="ps-panel-head"><h2>Members and roles</h2></div>
    <p class="ps-hint">Project members can access this project and be assigned to its work. A project role grants the rights configured for that role in this project only.</p>
    <Show when={error()}><p class="ps-error" role="alert">{error()}</p></Show>
    <ul class="ps-members">
      <For each={members()}>{member => {
        const assignment = () => assignmentFor(member);
        return <li class="ps-member-row">
          <div class="ps-member"><span class="ps-avatar" aria-hidden="true">{nameOf(member).slice(0, 1).toUpperCase()}</span><div><strong>{nameOf(member)}</strong><small>{member === props.owner ? "Project owner" : roleName(assignment())}</small></div></div>
          <Show when={props.canManage} fallback={<span class="ps-role-readonly">{roleName(assignment())}</span>}>
            <div class="ps-member-actions">
              <label class="sr-only" for={`project-role-${member}`}>Role for {nameOf(member)}</label>
              <select id={`project-role-${member}`} disabled={busy() === member} value={assignment()?.role_id ?? ""} onChange={event => void setRole(member, event.currentTarget.value)}>
                <option value="">Member (no extra role)</option>
                <For each={assignableRoles()}>{role => <option value={role.id}>{role.name}</option>}</For>
              </select>
              <Show when={member !== props.owner}><button type="button" class="ghost" disabled={busy() === member} onClick={() => void remove(member)}>Remove</button></Show>
            </div>
          </Show>
        </li>;
      }}</For>
    </ul>
    <Show when={!members.loading && !(members()?.length)}><p class="ps-hint">Nobody is on this project yet.</p></Show>
    <Show when={props.canManage}><div class="ps-add-member"><select aria-label="Add project member" value={memberId()} disabled={!!busy()} onChange={event => setMemberId(event.currentTarget.value)}><option value="">Add somebody…</option><For each={available()}>{profile => <option value={profile.id}>{profile.display_name || profile.username}</option>}</For></select><button type="button" class="primary" disabled={!memberId() || !!busy()} onClick={() => void add()}>Add member</button></div></Show>
  </section>;
}

function ProjectCustomFields(props: { projectId: string; canManage: boolean }) {
  const entityType = () => `issue:${props.projectId}`;
  const [definitions, { refetch }] = createResource(entityType, type => platformApi.cfDefinitions(type));
  const [name, setName] = createSignal("");
  const [type, setType] = createSignal<CfType>("text");
  const [options, setOptions] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const create = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!props.canManage) return;
    setError("");
    try {
      if (!name().trim()) throw new Error("Custom field name is required.");
      const listOptions = options().split(",").map(value => value.trim()).filter(Boolean);
      if (type() === "enum" && !listOptions.length) throw new Error("A list field needs at least one option.");
      setBusy(true);
      await platformApi.createCfDefinition({ entity_type: entityType(), cf_type: type(), name: name().trim(), constraints_json: type() === "enum" ? JSON.stringify({ options: listOptions }) : null });
      setName(""); setOptions(""); await refetch();
    } catch (reason) { setError(humanError(reason)); }
    finally { setBusy(false); }
  };
  const archive = async (definition: CfDefinition) => {
    setError(""); setBusy(true);
    try { await platformApi.archiveCfDefinition(definition.id, true); await refetch(); }
    catch (reason) { setError(humanError(reason)); }
    finally { setBusy(false); }
  };
  const optionsFor = (definition: CfDefinition) => { try { return JSON.parse(definition.constraints_json ?? "{}").options?.join(", ") ?? ""; } catch { return ""; } };
  return <section class="ps-panel ps-panel-wide">
    <div class="ps-panel-head"><h2>Issue custom fields</h2></div>
    <p class="ps-hint">Fields belong to this project’s issue tracker. They appear on every issue in this project; existing values are retained when a field is archived.</p>
    <Show when={error()}><p class="ps-error" role="alert">{error()}</p></Show>
    <ul class="ps-fields"><For each={definitions()}>{definition => <li><div><strong>{definition.name}</strong><small>{CF_TYPES.find(item => item.value === definition.cf_type)?.label ?? definition.cf_type}<Show when={optionsFor(definition)}>{values => <> · {values()}</>}</Show></small></div><Show when={props.canManage}><button type="button" class="ghost" disabled={busy()} onClick={() => void archive(definition)}>Archive</button></Show></li>}</For></ul>
    <Show when={!definitions.loading && !(definitions()?.length)}><p class="ps-hint ps-hint-quiet">No custom fields yet.</p></Show>
    <Show when={props.canManage}><form class="ps-field-form" onSubmit={create}><label class="ps-field"><span>Field name</span><input value={name()} placeholder="e.g. Customer impact" onInput={event => setName(event.currentTarget.value)} /></label><label class="ps-field"><span>Type</span><select value={type()} onChange={event => setType(event.currentTarget.value as CfType)}><For each={CF_TYPES}>{item => <option value={item.value}>{item.label} — {item.hint}</option>}</For></select></label><Show when={type() === "enum"}><label class="ps-field"><span>Options</span><input value={options()} placeholder="Low, Medium, High" onInput={event => setOptions(event.currentTarget.value)} /></label></Show><button class="primary" disabled={busy()}>Add field</button></form></Show>
  </section>;
}

export default function ProjectSettings() {
  const id = () => route().projectId ?? "";
  const project = createMemo(() => projects()?.find(item => item.id === id()));
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [deadline, setDeadline] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [confirmArchive, setConfirmArchive] = createSignal(false);
  createEffect(() => { const value = project(); setName(value?.name ?? ""); setDescription(value?.description ?? ""); setDeadline(value?.deadline ?? ""); });
  const actor = () => isWeb() ? currentUser()?.profile_id ?? "" : profileId();
  const canManage = () => !!project() && (currentUser()?.role === "admin" || project()!.created_by === actor());
  const save = async (event: SubmitEvent) => {
    event.preventDefault(); const value = project(); if (!value || !canManage()) return;
    setError(""); setBusy(true);
    try { if (!name().trim()) throw new Error("A project needs a name."); await platformApi.updateProject({ ...value, name: name().trim(), description: description().trim() || null, deadline: deadline() || null }); await reloadProjects(); }
    catch (reason) { setError(humanError(reason)); }
    finally { setBusy(false); }
  };
  const archive = async () => {
    const value = project(); if (!value || !canManage()) return;
    setError(""); setBusy(true);
    try { await platformApi.updateProject({ ...value, archived: true }); await reloadProjects(); setProjectId(""); navigate("Projects"); }
    catch (reason) { setError(humanError(reason)); }
    finally { setBusy(false); }
  };
  return <section class="ps-view">
    <header class="ps-head"><div class="ps-identity"><span class="ps-mark" aria-hidden="true">{project()?.key?.slice(0, 2) || "P"}</span><div><h1>Project settings</h1><p>{project()?.name ?? "Project unavailable"}<Show when={project()?.key}><code class="ps-keychip">{project()!.key}</code></Show></p></div></div></header>
    <Show when={!project()}><p class="ps-empty" role="alert">This project does not exist or is unavailable.</p></Show>
    <Show when={project()}><Show when={error()}><p class="ps-error" role="alert">{error()}</p></Show><Show when={!canManage()}><p class="ps-notice" role="status">Only the project owner or an administrator can change these settings.</p></Show>
      <div class="ps-grid"><section class="ps-panel"><div class="ps-panel-head"><h2>General</h2></div><form onSubmit={save}><label class="ps-field"><span>Project name</span><input disabled={!canManage()} value={name()} onInput={event => setName(event.currentTarget.value)} /></label><label class="ps-field"><span>Description <em>optional</em></span><textarea disabled={!canManage()} value={description()} onInput={event => setDescription(event.currentTarget.value)} /></label><label class="ps-field"><span>Deadline <em>optional</em></span><input disabled={!canManage()} type="date" value={deadline()} onInput={event => setDeadline(event.currentTarget.value)} /></label><Show when={canManage()}><div class="ps-actions"><button class="primary" disabled={busy()}>Save changes</button></div></Show></form></section><section class="ps-panel"><div class="ps-panel-head"><h2>Project identity</h2></div><p class="ps-hint">The key is permanent and identifies this project in issue links and integrations.</p><div class="ps-refrow"><div><span class="ps-reflabel">Project key</span><code class="ps-refid">{project()!.key}</code></div></div><div class="ps-refrow"><div><span class="ps-reflabel">Project ID</span><code class="ps-refid">{project()!.id}</code></div></div></section><ProjectMembers projectId={id()} owner={project()!.created_by} canManage={canManage()} /><ProjectCustomFields projectId={id()} canManage={canManage()} /></div>
      <Show when={canManage()}><section class="ps-danger"><div class="ps-danger-head"><h2>Archive project</h2></div><div class="ps-danger-row"><p><strong>Archive {project()!.name}</strong>It disappears from active project lists. Project data remains available for restoration.</p><Show when={confirmArchive()} fallback={<button type="button" class="danger-outline" onClick={() => setConfirmArchive(true)}>Archive project</button>}><div class="ps-confirm"><span>Archive this project?</span><button type="button" class="danger" disabled={busy()} onClick={() => void archive()}>Confirm archive</button><button type="button" disabled={busy()} onClick={() => setConfirmArchive(false)}>Cancel</button></div></Show></div></section></Show>
    </Show>
  </section>;
}
