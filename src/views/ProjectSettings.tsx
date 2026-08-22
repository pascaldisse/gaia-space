import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { platformApi, type CfDefinition, type CfType, type Profile, type RoleAssignment } from "../api/platform";
import { personalApi } from "../api/personal";
import { currentUser, humanError, profileId, profiles, projects, reloadProfiles, reloadProjects, setProjectId } from "../session";
import { navigate, route } from "../router";
import "./ProjectSettings.css";

const CF_TYPES: CfType[] = ["text", "int", "date", "enum", "profile", "bool"];
type CfForm = { name: string; cf_type: CfType; constraints: string };
const blankCf = (): CfForm => ({ name: "", cf_type: "text", constraints: "" });
const nameOf = (people: Profile[] | undefined, id: string) =>
  people?.find((person) => person.id === id)?.display_name || people?.find((person) => person.id === id)?.username || id;
const parseJson = (value: string | null): unknown => { try { return value ? JSON.parse(value) : undefined; } catch { return undefined; } };

function ProjectMembers(props: { projectId: string; allowed: boolean }) {
  const [error, setError] = createSignal("");
  const [memberId, setMemberId] = createSignal("");
  const [roleId, setRoleId] = createSignal("");
  const [members, { mutate: setMembers, refetch: reloadMembers }] = createResource(() => props.projectId, id => id ? personalApi.projectMemberIds(id) : Promise.resolve([]));
  const [roles] = createResource(platformApi.roles);
  const [assignments, { refetch: reloadAssignments }] = createResource(() => true, () => platformApi.assignments());
  const projectAssignments = () => (assignments() ?? []).filter(assignment =>
    assignment.scope_type === "project" && assignment.scope_id === props.projectId && !!assignment.profile_id,
  );
  const memberRoles = (member: string) => projectAssignments().filter(assignment => assignment.profile_id === member);
  const candidates = () => (profiles() ?? []).filter(person => !person.archived && !(members() ?? []).includes(person.id));
  const add = async () => {
    if (!memberId()) return;
    try {
      const next = await personalApi.addProjectMember(props.projectId, memberId());
      setMembers(next); setError("");
      if (roleId()) await platformApi.createAssignment({ role_id: roleId(), profile_id: memberId(), team_id: null, scope_type: "project", scope_id: props.projectId });
      setMemberId(""); setRoleId(""); await reloadAssignments();
    } catch (reason) { setError(humanError(reason)); void reloadMembers(); void reloadAssignments(); }
  };
  const remove = async (member: string) => {
    try { setMembers(await personalApi.removeProjectMember(props.projectId, member)); setError(""); }
    catch (reason) { setError(humanError(reason)); void reloadMembers(); }
  };
  const grant = async (member: string, nextRole: string) => {
    if (!nextRole) return;
    try {
      await platformApi.createAssignment({ role_id: nextRole, profile_id: member, team_id: null, scope_type: "project", scope_id: props.projectId });
      setError(""); await reloadAssignments();
    } catch (reason) { setError(humanError(reason)); }
  };
  const revoke = async (assignment: RoleAssignment) => {
    try { await platformApi.deleteAssignment(assignment.id); setError(""); await reloadAssignments(); }
    catch (reason) { setError(humanError(reason)); }
  };
  if (!profiles()) void reloadProfiles().catch(() => undefined);
  return <section class="ps-panel ps-panel-wide">
    <div class="ps-panel-head"><h2>Members and project roles</h2></div>
    <p class="ps-hint">Project members can be assigned work. Roles are scoped to this project; they do not change someone’s organization-wide access.</p>
    <Show when={error()}><p class="ps-error" role="alert">{error()}</p></Show>
    <Show when={members.loading}><p class="ps-hint">Loading project members…</p></Show>
    <ul class="ps-members">
      <For each={members()}>{member => <li>
        <div><strong>{nameOf(profiles(), member)}</strong><code>{member}</code></div>
        <div class="ps-member-roles">
          <For each={memberRoles(member)}>{assignment => <span class="ps-role-chip">{roles()?.find(role => role.id === assignment.role_id)?.name ?? assignment.role_id}
            <Show when={props.allowed}><button type="button" aria-label={`Remove project role from ${nameOf(profiles(), member)}`} onClick={() => void revoke(assignment)}>×</button></Show>
          </span>}</For>
          <Show when={props.allowed}><select aria-label={`Add role for ${nameOf(profiles(), member)}`} value="" onChange={event => { const value = event.currentTarget.value; event.currentTarget.value = ""; void grant(member, value); }}>
            <option value="">Add role…</option><For each={roles()?.filter(role => !role.archived)}>{role => <option value={role.id}>{role.name}</option>}</For>
          </select></Show>
        </div>
        <Show when={props.allowed}><button type="button" class="ghost" onClick={() => void remove(member)}>Remove</button></Show>
      </li>}</For>
    </ul>
    <Show when={!members.loading && !(members()?.length)}><p class="ps-hint">No members yet. Add people before assigning project work.</p></Show>
    <Show when={props.allowed}><div class="ps-add-member">
      <select aria-label="Project member" value={memberId()} onChange={event => setMemberId(event.currentTarget.value)}>
        <option value="">Add a person…</option><For each={candidates()}>{person => <option value={person.id}>{person.display_name || person.username}</option>}</For>
      </select>
      <select aria-label="Initial project role" value={roleId()} onChange={event => setRoleId(event.currentTarget.value)}>
        <option value="">No project role</option><For each={roles()?.filter(role => !role.archived)}>{role => <option value={role.id}>{role.name}</option>}</For>
      </select>
      <button type="button" class="primary" disabled={!memberId()} onClick={() => void add()}>Add member</button>
    </div></Show>
  </section>;
}

function ProjectCustomFields(props: { projectId: string; allowed: boolean }) {
  const [error, setError] = createSignal("");
  const [form, setForm] = createSignal(blankCf());
  const [values, { refetch: reloadValues }] = createResource(() => props.projectId, id => id ? platformApi.cfGetValues("project", id) : Promise.resolve([]));
  const [drafts, setDrafts] = createSignal<Record<string, unknown>>({});
  createEffect(() => {
    const next: Record<string, unknown> = {};
    for (const field of values() ?? []) next[field.id] = parseJson(field.value_json) ?? parseJson(field.default_json) ?? (field.cf_type === "bool" ? false : "");
    setDrafts(next);
  });
  const draft = (field: CfDefinition) => drafts()[field.id];
  const setDraft = (field: CfDefinition, value: unknown) => setDrafts({ ...drafts(), [field.id]: value });
  const saveValues = async () => {
    try {
      await Promise.all((values() ?? []).map(field => platformApi.cfSetValue(field.id, props.projectId, JSON.stringify(draft(field)))));
      setError(""); await reloadValues();
    } catch (reason) { setError(humanError(reason)); }
  };
  const addDefinition = async () => {
    const input = form();
    if (!input.name.trim()) { setError("Custom field name is required."); return; }
    try {
      const constraints_json = input.cf_type === "enum"
        ? JSON.stringify({ options: input.constraints.split(",").map(value => value.trim()).filter(Boolean) })
        : input.constraints.trim() || null;
      if (input.cf_type === "enum" && !(parseJson(constraints_json) as { options?: unknown[] } | undefined)?.options?.length) throw new Error("List fields need at least one option.");
      await platformApi.createCfDefinition({ entity_type: "project", cf_type: input.cf_type, name: input.name.trim(), constraints_json });
      setForm(blankCf()); setError(""); await reloadValues();
    } catch (reason) { setError(humanError(reason)); }
  };
  const archive = async (field: CfDefinition) => {
    try { await platformApi.archiveCfDefinition(field.id, true); setError(""); await reloadValues(); }
    catch (reason) { setError(humanError(reason)); }
  };
  const fieldInput = (field: CfDefinition) => {
    const value = draft(field);
    if (field.cf_type === "bool") return <input type="checkbox" checked={Boolean(value)} disabled={!props.allowed} onChange={event => setDraft(field, event.currentTarget.checked)} />;
    if (field.cf_type === "enum") {
      const options = (parseJson(field.constraints_json) as { options?: unknown[] } | undefined)?.options ?? [];
      return <select value={String(value ?? "")} disabled={!props.allowed} onChange={event => setDraft(field, event.currentTarget.value)}><option value="">Select…</option><For each={options}>{option => <option value={String(option)}>{String(option)}</option>}</For></select>;
    }
    if (field.cf_type === "profile") return <select value={String(value ?? "")} disabled={!props.allowed} onChange={event => setDraft(field, event.currentTarget.value)}><option value="">Select a member…</option><For each={profiles()?.filter(person => !person.archived)}>{person => <option value={person.id}>{person.display_name || person.username}</option>}</For></select>;
    return <input type={field.cf_type === "date" ? "date" : field.cf_type === "int" ? "number" : "text"} value={String(value ?? "")} disabled={!props.allowed} onInput={event => setDraft(field, field.cf_type === "int" ? Number(event.currentTarget.value) : event.currentTarget.value)} />;
  };
  return <section class="ps-panel ps-panel-wide">
    <div class="ps-panel-head"><h2>Custom fields</h2></div>
    <p class="ps-hint">Add typed project metadata for planning, reporting, and ownership. Definitions apply to every project; values stay on this project.</p>
    <Show when={error()}><p class="ps-error" role="alert">{error()}</p></Show>
    <Show when={values.loading}><p class="ps-hint">Loading custom fields…</p></Show>
    <div class="ps-custom-fields"><For each={values()}>{field => <label class="ps-field"><span>{field.name} <em>{field.cf_type}</em></span>{fieldInput(field)}
      <Show when={props.allowed}><button type="button" class="ps-remove-field" onClick={() => void archive(field)}>Remove field</button></Show>
    </label>}</For></div>
    <Show when={!values.loading && !(values()?.length)}><p class="ps-hint">No custom fields yet. Add one below to capture project-specific information.</p></Show>
    <Show when={props.allowed && (values()?.length)}><div class="ps-actions"><button type="button" class="primary" onClick={() => void saveValues()}>Save custom fields</button></div></Show>
    <Show when={props.allowed}><div class="ps-add-field">
      <input aria-label="Custom field name" placeholder="Field name" value={form().name} onInput={event => setForm({ ...form(), name: event.currentTarget.value })} />
      <select aria-label="Custom field type" value={form().cf_type} onChange={event => setForm({ ...form(), cf_type: event.currentTarget.value as CfType })}><For each={CF_TYPES}>{type => <option value={type}>{type}</option>}</For></select>
      <Show when={form().cf_type === "enum"}><input aria-label="Custom field options" placeholder="Options, separated by commas" value={form().constraints} onInput={event => setForm({ ...form(), constraints: event.currentTarget.value })} /></Show>
      <Show when={form().cf_type === "text" || form().cf_type === "int"}><input aria-label="Custom field constraints" placeholder='Constraints JSON, e.g. {"min":0}' value={form().constraints} onInput={event => setForm({ ...form(), constraints: event.currentTarget.value })} /></Show>
      <button type="button" class="primary" onClick={() => void addDefinition()}>Add field</button>
    </div></Show>
  </section>;
}

export default function ProjectSettings() {
  const id = () => route().projectId ?? "";
  const project = createMemo(() => projects()?.find(item => item.id === id()));
  const [name, setName] = createSignal(""); const [description, setDescription] = createSignal(""); const [deadline, setDeadline] = createSignal("");
  const [error, setError] = createSignal(""); const [notice, setNotice] = createSignal(""); const [busy, setBusy] = createSignal(false); const [confirm, setConfirm] = createSignal(false);
  createEffect(() => { const item = project(); setName(item?.name ?? ""); setDescription(item?.description ?? ""); setDeadline(item?.deadline ?? ""); });
  const allowed = () => !!project() && (currentUser()?.role === "admin" || project()!.created_by === profileId());
  const save = async () => {
    const item = project(); if (!item || !allowed()) return;
    try { if (!name().trim()) throw new Error("A project needs a name."); setBusy(true); await platformApi.updateProject({ ...item, name: name().trim(), description: description().trim() || null, deadline: deadline() || null }); await reloadProjects(); setNotice("Project details saved."); setError(""); }
    catch (reason) { setError(humanError(reason)); } finally { setBusy(false); }
  };
  const archive = async () => {
    const item = project(); if (!item || !allowed()) return;
    try { setBusy(true); await platformApi.updateProject({ ...item, archived: true }); await reloadProjects(); setProjectId(""); navigate("Projects"); }
    catch (reason) { setError(humanError(reason)); } finally { setBusy(false); }
  };
  return <section class="ps-view">
    <header class="ps-head"><div class="ps-identity"><div class="ps-mark">{(project()?.key ?? "··").slice(0, 2).toUpperCase()}</div><div><h1>Project settings</h1><p><span class="ps-keychip">{project()?.key ?? "—"}</span>{project()?.name ?? "Project unavailable"}</p></div></div></header>
    <Show when={!project()}><p class="ps-empty" role="alert">This project does not exist or is unavailable.</p></Show>
    <Show when={project()}><Show when={error()}><p class="ps-error" role="alert">{error()}</p></Show><Show when={notice()}><p class="ps-notice" role="status">{notice()}</p></Show>
      <Show when={!allowed()}><p class="ps-notice" role="status">Only the project owner or an administrator can change these settings.</p></Show>
      <div class="ps-grid"><section class="ps-panel"><div class="ps-panel-head"><h2>Project parameters</h2></div><p class="ps-hint">The name, summary, and target date shown throughout the project workspace.</p>
        <label class="ps-field"><span>Name</span><input disabled={!allowed()} value={name()} onInput={event => setName(event.currentTarget.value)} /></label>
        <label class="ps-field"><span>Description <em>optional</em></span><textarea disabled={!allowed()} value={description()} onInput={event => setDescription(event.currentTarget.value)} /></label>
        <label class="ps-field"><span>Deadline <em>optional</em></span><input disabled={!allowed()} type="date" value={deadline()} onInput={event => setDeadline(event.currentTarget.value)} /></label>
        <label class="ps-field"><span>Project key</span><input disabled value={project()!.key} /></label><p class="ps-hint ps-hint-quiet">The key prefixes issue numbers and cannot change after creation.</p>
        <div class="ps-actions"><button type="button" class="primary" disabled={!allowed() || busy()} onClick={() => void save()}>{busy() ? "Saving…" : "Save parameters"}</button></div>
      </section>
      <section class="ps-panel"><div class="ps-panel-head"><h2>Access model</h2></div><p class="ps-hint">Project roles grant rights within this project only. Membership controls who can receive project work.</p><dl class="ps-access-summary"><dt>Owner</dt><dd>{project()!.created_by ? nameOf(profiles(), project()!.created_by!) : "Server-managed"}</dd><dt>Scope</dt><dd>Project · {project()!.key}</dd><dt>Custom metadata</dt><dd>Typed fields, shared definition set</dd></dl></section>
      <ProjectMembers projectId={id()} allowed={allowed()} /><ProjectCustomFields projectId={id()} allowed={allowed()} /></div>
      <section class="ps-danger"><div class="ps-danger-head"><h2>Danger zone</h2></div><div class="ps-danger-row"><div><strong>Archive this project</strong><p>Its work stays recoverable; nothing is permanently deleted.</p></div><Show when={allowed()}><Show when={confirm()} fallback={<button type="button" class="danger-outline" onClick={() => setConfirm(true)}>Archive project</button>}><div class="ps-confirm"><span>Archive “{project()!.name}”?</span><button type="button" class="ghost" onClick={() => setConfirm(false)}>Cancel</button><button type="button" class="danger" disabled={busy()} onClick={() => void archive()}>Confirm archive</button></div></Show></Show></div></section>
    </Show>
  </section>;
}
