import { createEffect, createMemo, createResource, createSignal, For, onMount, Show } from "solid-js";
import PageHeader from "../components/PageHeader";
import { platformApi, type CfDefinition, type CfType, type RoleAssignment } from "../api/platform";
import { Disclosure } from "../components/blocks";
import { PillSelect } from "../components/controls";
import DateField from "../components/DateField";
import EmptyState from "../components/EmptyState";
import { personalApi } from "../api/personal";
import { currentUser, humanError, isWeb, profileId, profiles, projects, reloadProfiles, reloadProjects, setProjectId } from "../session";
import { navigate, route } from "../router";
import "./ProjectSettings.css";

const CF_TYPES: { value: CfType; label: string; hint: string }[] = [
  { value: "text", label: "Text", hint: "Short text" }, { value: "text_list", label: "Text list", hint: "Multiple text values" },
  { value: "int", label: "Number", hint: "Whole number" }, { value: "int_list", label: "Number list", hint: "Multiple whole numbers" },
  { value: "enum", label: "List", hint: "One choice" }, { value: "enum_list", label: "List", hint: "Multiple choices" },
  { value: "open_enum", label: "Open list", hint: "One free-form choice" }, { value: "open_enum_list", label: "Open list", hint: "Multiple free-form choices" },
  { value: "bool", label: "Checkbox", hint: "Yes or no" }, { value: "date", label: "Date", hint: "Calendar date" }, { value: "datetime", label: "Date and time", hint: "Timestamp" },
  { value: "percentage", label: "Percentage", hint: "0 to 100%" }, { value: "fraction", label: "Fraction", hint: "0 to 1" }, { value: "profile", label: "Organization member", hint: "Member reference" }, { value: "profile_list", label: "Organization members", hint: "Multiple members" },
  { value: "team", label: "Team", hint: "Team reference" }, { value: "location", label: "Location", hint: "Location value" }, { value: "project", label: "Project", hint: "Project reference" }, { value: "url", label: "Link", hint: "http(s) URL" }, { value: "contact", label: "Contact", hint: "Contact reference" }, { value: "contact_list", label: "Contacts", hint: "Multiple contacts" }, { value: "autonumber", label: "Autonumber", hint: "Generated number" }, { value: "issue", label: "Ticket", hint: "Ticket reference" }, { value: "issue_list", label: "Tickets", hint: "Multiple tickets" },
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
  // The select is uncontrolled once the user picks: a refused write leaves the browser showing
  // the role the server never granted, so keep a handle per row and put it back.
  const pickers = new Map<string, HTMLSelectElement>();
  const setRole = async (member: string, roleId: string) => {
    const previous = assignmentFor(member);
    if ((previous?.role_id ?? "") === roleId) return;
    setError(""); setBusy(member);
    // Grant the new role BEFORE dropping the old one. delete-then-create loses the member's
    // role outright when the create is denied; this order leaves the previous grant intact.
    try {
      if (roleId) await platformApi.createAssignment({ role_id: roleId, profile_id: member, scope_type: "project", scope_id: props.projectId });
      if (previous) await platformApi.deleteAssignment(previous.id);
      await reloadAssignments();
    } catch (reason) {
      setError(humanError(reason));
      await reloadAssignments();
      const picker = pickers.get(member);
      if (picker) picker.value = assignmentFor(member)?.role_id ?? "";
    }
    finally { setBusy(""); }
  };

  return <section class="ps-panel ps-panel-wide">
    <div class="ps-panel-head"><h2>Members and project roles</h2></div>
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
              <select ref={element => pickers.set(member, element)} id={`project-role-${member}`} disabled={busy() === member} value={assignment()?.role_id ?? ""} onChange={event => void setRole(member, event.currentTarget.value)}>
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

/** LAW: the project lead is PURELY INFORMATIONAL. It names one main responsible person and
 *  grants NOTHING — no wider read, no exclusive write, no gated UI action anywhere. Every
 *  project member keeps identical ability to see all project tasks and to create tasks for
 *  themselves AND for others. The ONE lead-related restriction in the product is right here:
 *  WHO MAY EDIT the field (owner-or-admin, the same `canManage()` door as the rest of these
 *  settings). Being lead never opens that door either. */
function ProjectLead(props: { projectId: string; leadId: string | null; canManage: boolean; actor: string }) {
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [members] = createResource(() => props.projectId, id => id ? personalApi.projectMemberIds(id) : Promise.resolve([] as string[]));
  const candidates = () => (profiles() ?? []).filter(profile => !profile.archived && (members() ?? []).includes(profile.id));
  if (!profiles()) void reloadProfiles().catch(() => undefined);
  // Options arrive after the select mounts (members + profiles are async). Re-apply the
  // controlled value then, or the browser keeps showing "No lead" for a project that has one.
  let picker!: HTMLSelectElement;
  createEffect(() => { candidates(); const value = props.leadId ?? ""; if (picker && picker.value !== value) picker.value = value; });
  const save = async (value: string) => {
    if (!props.canManage || value === (props.leadId ?? "")) return;
    setError(""); setBusy(true);
    try { await platformApi.setProjectLead(props.projectId, value || null, props.actor); await reloadProjects(); }
    catch (reason) { setError(humanError(reason)); }
    finally { setBusy(false); }
  };
  return <section class="ps-panel">
    <div class="ps-panel-head"><h2>Responsible person</h2></div>
    <p class="ps-hint">The lead is the one main responsible person. It is informational only: every member keeps the same access to this project's work.</p>
    <Show when={error()}><p class="ps-error" role="alert">{error()}</p></Show>
    <label class="ps-field"><span>Responsible <em>optional</em></span>
      <select ref={picker} aria-label="Project lead" disabled={!props.canManage || busy()} value={props.leadId ?? ""} onChange={event => void save(event.currentTarget.value)}>
        <option value="">No lead</option>
        <For each={candidates()}>{profile => <option value={profile.id}>{profile.display_name || profile.username}</option>}</For>
      </select>
    </label>
    <Show when={props.leadId && !candidates().some(profile => profile.id === props.leadId)}><p class="ps-hint ps-hint-quiet">Current lead: {nameOf(props.leadId!)}</p></Show>
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
      if ((type() === "enum" || type() === "enum_list") && !listOptions.length) throw new Error("A list field needs at least one option.");
      setBusy(true);
      await platformApi.createCfDefinition({ entity_type: entityType(), cf_type: type(), name: name().trim(), constraints_json: (type() === "enum" || type() === "enum_list") ? JSON.stringify({ options: listOptions }) : null });
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
    <div class="ps-panel-head"><h2>Custom fields</h2></div>
    <p class="ps-hint">Fields belong to this project’s ticket tracker. They appear on every ticket in this project; existing values are retained when a field is archived.</p>
    <Show when={error()}><p class="ps-error" role="alert">{error()}</p></Show>
    <ul class="ps-fields"><For each={definitions()}>{definition => <li><div><strong>{definition.name}</strong><small>{CF_TYPES.find(item => item.value === definition.cf_type)?.label ?? definition.cf_type}<Show when={optionsFor(definition)}>{values => <> · {values()}</>}</Show></small></div><Show when={props.canManage}><button type="button" class="ghost" disabled={busy()} onClick={() => void archive(definition)}>Archive</button></Show></li>}</For></ul>
    <Show when={!definitions.loading && !(definitions()?.length)}><p class="ps-hint ps-hint-quiet">No custom fields yet.</p></Show>
    <Show when={props.canManage}><form class="ps-field-form" onSubmit={create}><label class="ps-field"><span>Field name</span><input value={name()} placeholder="e.g. Customer impact" onInput={event => setName(event.currentTarget.value)} /></label><label class="ps-field"><span>Type</span><select value={type()} onChange={event => setType(event.currentTarget.value as CfType)}><For each={CF_TYPES}>{item => <option value={item.value}>{item.label} — {item.hint}</option>}</For></select></label><Show when={(type() === "enum" || type() === "enum_list")}><label class="ps-field"><span>Options</span><input value={options()} placeholder="Low, Medium, High" onInput={event => setOptions(event.currentTarget.value)} /></label></Show><button class="primary" disabled={busy()}>Add field</button></form></Show>
  </section>;
}

/* ── ACCESS: PROJECT ROLES AND TEAM BINDINGS ─────────────────────────────────
   MOVED HERE from views/Projects.tsx (stage 19). It was a `Disclosure` stacked at the
   bottom of the ALL-PROJECTS page, under an embedded board — administration of ONE
   project, rendered on the list of every project. Its home is the project's own
   settings, beside "Members and project roles", which is the same subject.
   The component is unchanged; only its address is. */
// Project roles: the per-project half of the role model (V92). A role is either
// minted from an organization template (inheriting its name+kind) or named here;
// a team binding gives a whole team that role. Every refusal the server can raise
// (foreign project, archived role, missing right) lands in this panel's own error
// line, so it can never be mistaken for a failure of the project card above it.
function ProjectRoles(props: { projectId: string }) {
  const [panelError, setPanelError] = createSignal("");
  const [templates] = createResource(platformApi.projectRoleTemplates);
  const [teams] = createResource(platformApi.teams);
  const [roles, rolesResource] = createResource(() => props.projectId, id => platformApi.projectRoles(id));
  const [bindings, bindingsResource] = createResource(() => props.projectId, id => platformApi.projectTeamRoles(id));
  const [templateId, setTemplateId] = createSignal("");
  const [roleName, setRoleName] = createSignal("");
  const [teamId, setTeamId] = createSignal("");
  const [bindRoleId, setBindRoleId] = createSignal("");
  const liveRoles = createMemo(() => (roles() ?? []).filter(role => !role.archived));
  const liveTemplates = createMemo(() => (templates() ?? []).filter(template => !template.archived));
  const roleName_ = (id: string) => (roles() ?? []).find(role => role.id === id)?.name ?? id;
  const teamName = (id: string) => (teams() ?? []).find(team => team.id === id)?.name ?? id;
  const guard = async (work: () => Promise<unknown>) => {
    setPanelError("");
    try { await work(); } catch (reason) { setPanelError(humanError(reason)); }
  };
  const addRole = (event: SubmitEvent) => {
    event.preventDefault();
    // Name is optional only when a template supplies one — the same rule the server keeps.
    void guard(async () => {
      const template = templateId() || null;
      const name = roleName().trim();
      if (!template && !name) throw new Error("Pick a template or name the role.");
      await platformApi.createProjectRole({ project_id: props.projectId, template_id: template, name: name || null });
      setRoleName(""); setTemplateId("");
      await rolesResource.refetch();
    });
  };
  const bind = (event: SubmitEvent) => {
    event.preventDefault();
    void guard(async () => {
      if (!teamId() || !bindRoleId()) throw new Error("Pick a team and a role.");
      await platformApi.assignProjectTeamRole(props.projectId, teamId(), bindRoleId());
      await bindingsResource.refetch();
    });
  };
  // Access is administration, not daily work: it stays folded away under the board
  // and says in its own summary how much is configured, so nobody opens it to look.
  return <Disclosure
    class="project-access"
    title="Access"
    meta={`${liveRoles().length} roles · ${(bindings() ?? []).length} team bindings`}
  >
    <section class="project-roles">
    <h3>Roles</h3>
    <Show when={panelError()}><p class="error" role="alert">{panelError()}</p></Show>
    <form class="project-role-form" onSubmit={addRole}>
      {/* L4: the resting option says what the control is for, so the caption above
          it was a second copy of the same word. */}
      <PillSelect label="Role template" value={templateId()} onChange={setTemplateId}>
        <option value="">No template (name it below)</option>
        <For each={liveTemplates()}>{template=><option value={template.id}>{template.name} ({template.role_kind})</option>}</For>
      </PillSelect>
      <input placeholder="Role name (optional with a template)" aria-label="Project role name" value={roleName()} onInput={e=>setRoleName(e.currentTarget.value)}/>
      <button class="primary">Add role</button>
    </form>
    {/* The "Add role" form is directly above: the line points at it instead of
        drawing a second button for the same command. */}
    <Show when={!roles()?.length}><EmptyState title="No project roles yet" hint="Add one above — from a template, or with a name of your own." /></Show>
    <ul class="project-role-list"><For each={roles()}>{role=>
      <li classList={{ archived: role.archived }}>
        <strong>{role.name}</strong> <code>{role.role_kind}</code>
        <Show when={role.template_id}><span class="hint"> from template</span></Show>
        <button class="ghost" onClick={()=>void guard(async()=>{ await platformApi.archiveProjectRole(role.id, !role.archived); await rolesResource.refetch(); })}>
          {role.archived ? "Restore" : "Archive"}
        </button>
      </li>
    }</For></ul>
    <h3>Team bindings</h3>
    <form class="project-role-form" onSubmit={bind}>
      <PillSelect label="Team" value={teamId()} onChange={setTeamId}>
        <option value="">Select a team</option>
        <For each={(teams() ?? []).filter(team=>!team.archived)}>{team=><option value={team.id}>{team.name}</option>}</For>
      </PillSelect>
      <PillSelect label="Project role" value={bindRoleId()} onChange={setBindRoleId}>
        <option value="">Select a role</option>
        <For each={liveRoles()}>{role=><option value={role.id}>{role.name}</option>}</For>
      </PillSelect>
      <button class="primary">Bind team</button>
    </form>
    <Show when={!bindings()?.length}><EmptyState title="No team carries a role in this project yet" hint="Bind a team to a role with the form above." /></Show>
    <ul class="project-role-list"><For each={bindings()}>{binding=>
      <li>
        <strong>{teamName(binding.team_id)}</strong> → {roleName_(binding.project_role_id)}
        <button class="ghost" onClick={()=>void guard(async()=>{ await platformApi.removeProjectTeamRole(binding.project_id, binding.team_id, binding.project_role_id); await bindingsResource.refetch(); })}>Remove</button>
      </li>
    }</For></ul>
    </section>
  </Disclosure>;
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
  onMount(() => { void reloadProjects().catch(() => undefined); });
  createEffect(() => { const value = project(); setName(value?.name ?? ""); setDescription(value?.description ?? ""); setDeadline(value?.deadline ?? ""); });
  const actor = () => isWeb() ? currentUser()?.profile_id ?? "" : profileId();
  const canManage = () => !!project() && (currentUser()?.role === "GlobalAdmin" || project()!.created_by === actor());
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
    {/* The .ps-mark tile stays: it IDENTIFIES this project (its key), it is not
        page decoration like the old per-view icon lozenges were. */}
    <header class="ps-head"><span class="ps-mark" aria-hidden="true">{project()?.key?.slice(0, 2) || "P"}</span><PageHeader icon="layers" kicker={project()?.name ?? "Project unavailable"} title="Project settings" subline="Name, key, members and the rules this one project runs by." chips={<Show when={project()?.key}><code class="ps-keychip">{project()!.key}</code></Show>} /></header>
    <Show when={!project()}><p class="ps-empty" role="alert">This project does not exist or is unavailable.</p></Show>
    <Show when={project()}><Show when={error()}><p class="ps-error" role="alert">{error()}</p></Show><Show when={!canManage()}><p class="ps-notice" role="status">Only the project owner or an administrator can change these settings.</p></Show>
      <div class="ps-grid"><section class="ps-panel"><div class="ps-panel-head"><h2>General</h2></div><form onSubmit={save}><label class="ps-field"><span>Project name</span><input disabled={!canManage()} value={name()} onInput={event => setName(event.currentTarget.value)} /></label><label class="ps-field"><span>Description <em>optional</em></span><textarea disabled={!canManage()} value={description()} onInput={event => setDescription(event.currentTarget.value)} /></label>{/* A div, not a label: the deadline is picked in the product's month grid, and the control is a button. */}<div class="ps-field"><span>Deadline <em>optional</em></span><DateField label="Deadline" value={deadline()} onChange={setDeadline} disabled={!canManage()} placeholder="No deadline" /></div><Show when={canManage()}><div class="ps-actions"><button class="primary" disabled={busy()}>Save changes</button></div></Show></form></section><section class="ps-panel"><div class="ps-panel-head"><h2>Project identity</h2></div><p class="ps-hint">The key is permanent and identifies this project in ticket links and integrations.</p><div class="ps-refrow"><div><span class="ps-reflabel">Project key</span><code class="ps-refid">{project()!.key}</code></div></div><div class="ps-refrow"><div><span class="ps-reflabel">Project ID</span><code class="ps-refid">{project()!.id}</code></div></div></section><ProjectLead projectId={id()} leadId={project()!.lead_id} canManage={canManage()} actor={actor()} /><ProjectMembers projectId={id()} owner={project()!.created_by} canManage={canManage()} /><ProjectCustomFields projectId={id()} canManage={canManage()} /></div>
      <ProjectRoles projectId={id()} />
      <Show when={canManage()}><section class="ps-danger"><div class="ps-danger-head"><h2>Archive project</h2></div><div class="ps-danger-row"><p><strong>Archive {project()!.name}</strong>It disappears from active project lists. Project data remains available for restoration.</p><Show when={confirmArchive()} fallback={<button type="button" class="danger-outline" onClick={() => setConfirmArchive(true)}>Archive project</button>}><div class="ps-confirm"><span>Archive this project?</span><button type="button" class="danger" disabled={busy()} onClick={() => void archive()}>Confirm archive</button><button type="button" disabled={busy()} onClick={() => setConfirmArchive(false)}>Cancel</button></div></Show></div></section></Show>
    </Show>
  </section>;
}
