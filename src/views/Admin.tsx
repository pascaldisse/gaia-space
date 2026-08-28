import { createResource, createSignal, For, Show, onMount } from "solid-js";
import { platformApi, type Role, type Right, type RoleAssignment, type ScopeType, type CfDefinition, type CfType } from "../api/platform";
import "../components/paper.css";
import "./Admin.css";
import "./operatorForm.css";
import PageHeader, { Chip } from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { GhostPill, PillSelect } from "../components/controls";

const SCOPE_TYPES: ScopeType[] = ["global", "project", "team", "profile", "channel", "document", "documentFolder"];
const CF_ENTITY_TYPES = ["issue", "profile", "team", "membership"];
const CF_TYPES: CfType[] = ["text", "text_list", "int", "int_list", "enum", "enum_list", "open_enum", "open_enum_list", "bool", "date", "datetime", "percentage", "fraction", "profile", "profile_list", "team", "location", "project", "url", "contact", "contact_list", "autonumber", "issue", "issue_list"];
const blankRole = () => ({ name: "", description: "" });
const blankCf = () => ({ entity_type: "issue", cf_type: "text" as CfType, name: "", constraints: "" });
/** These lists are stored values AND, until now, the label the user read. Only the
 *  label follows the Issue→Ticket rename; the value stays `issue` / `issue_list`,
 *  because it is what the server persists and compares. */
const cfLabel = (value: string) => value.replace(/^issue$/, "ticket").replace(/^issue_list$/, "ticket_list");
/** A picker's resting VALUE is its label, so the value has to be a word a human
 *  reads. `documentFolder` and `text_list` are wire identifiers; they were being
 *  printed at the user unchanged. The stored value is untouched — only the text. */
const scopeLabel = (scope: ScopeType): string =>
  scope === "global" ? "Everywhere"
  : scope === "documentFolder" ? "In one document folder"
  : `In one ${scope}`;
const cfTypeLabel = (type: string): string =>
  cfLabel(type).replace(/_list$/, " list").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export default function Admin() {
  const [error, setError] = createSignal("");
  const [seeded, setSeeded] = createSignal(0);
  onMount(async () => { try { setSeeded(await platformApi.seedRights()); reloadRights(); } catch (e) { setError(String(e)); } });

  // --- Roles + rights matrix -------------------------------------------------
  const [roles, { refetch: reloadRoles }] = createResource(() => platformApi.roles());
  const [rights, { refetch: reloadRights }] = createResource(() => platformApi.rights());
  const [selectedRole, setSelectedRole] = createSignal<Role | null>(null);
  const [roleForm, setRoleForm] = createSignal(blankRole());
  const [roleRightCodes, { refetch: reloadRoleRights }] = createResource(
    () => selectedRole()?.id,
    (id) => (id ? platformApi.roleRights(id) : Promise.resolve([] as string[])),
  );
  const [rightGroups] = createResource(() => platformApi.rightGroups());
  // Rights are grouped by their KB `RightGroup`, in the registry's display order; the
  // group code is only a key, so an unregistered code still renders under its own code
  // rather than disappearing from the matrix.
  const groupedRights = (): [string, Right[]][] => {
    const registry = new Map((rightGroups() ?? []).map((g, index) => [g.code, { title: g.title, order: index }]));
    const groups = new Map<string, Right[]>();
    for (const r of rights() ?? []) {
      const key = r.right_group ?? "Ungrouped";
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .sort((a, b) => (registry.get(a[0])?.order ?? 999) - (registry.get(b[0])?.order ?? 999) || a[0].localeCompare(b[0]))
      .map(([code, list]) => [registry.get(code)?.title ?? code, list.sort((a, b) => a.title.localeCompare(b.title))] as [string, Right[]]);
  };
  const saveRole = async (e: SubmitEvent) => {
    e.preventDefault();
    try {
      const f = roleForm();
      if (!f.name.trim()) throw new Error("Role name is required.");
      const role = await platformApi.createRole({ name: f.name.trim(), description: f.description || null, parent_id: null });
      setRoleForm(blankRole()); reloadRoles(); setSelectedRole(role);
    } catch (e) { setError(String(e)); }
  };
  const toggleArchiveRole = async (r: Role) => { try { await platformApi.archiveRole(r.id, !r.archived); reloadRoles(); } catch (e) { setError(String(e)); } };
  const toggleRight = async (code: string) => {
    const role = selectedRole(); if (!role) return;
    const current = new Set(roleRightCodes() ?? []);
    current.has(code) ? current.delete(code) : current.add(code);
    try { await platformApi.setRoleRights(role.id, [...current]); reloadRoleRights(); } catch (e) { setError(String(e)); }
  };

  // --- Role assignments -------------------------------------------------------
  const [profiles] = createResource(() => platformApi.profiles());
  const [teams] = createResource(() => platformApi.teams());
  const [assignments, { refetch: reloadAssignments }] = createResource(() => platformApi.assignments());
  const [targetKind, setTargetKind] = createSignal<"profile" | "team">("profile");
  const [targetId, setTargetId] = createSignal("");
  const [assignRoleId, setAssignRoleId] = createSignal("");
  const [scopeType, setScopeType] = createSignal<ScopeType>("global");
  const [scopeId, setScopeId] = createSignal("");
  const createAssignment = async () => {
    if (!assignRoleId() || !targetId()) return;
    try {
      await platformApi.createAssignment({
        role_id: assignRoleId(),
        profile_id: targetKind() === "profile" ? targetId() : null,
        team_id: targetKind() === "team" ? targetId() : null,
        scope_type: scopeType(),
        scope_id: scopeType() === "global" ? null : (scopeId() || null),
      });
      setTargetId(""); setScopeId(""); reloadAssignments();
    } catch (e) { setError(String(e)); }
  };
  const removeAssignment = async (a: RoleAssignment) => { try { await platformApi.deleteAssignment(a.id); reloadAssignments(); } catch (e) { setError(String(e)); } };
  const roleName = (id: string) => roles()?.find(r => r.id === id)?.name ?? id;
  const targetLabel = (a: RoleAssignment) => a.profile_id
    ? `profile: ${profiles()?.find(p => p.id === a.profile_id)?.display_name ?? a.profile_id}`
    : `team: ${teams()?.find(t => t.id === a.team_id)?.name ?? a.team_id}`;

  // --- check_right tester ------------------------------------------------------
  const [checkProfileId, setCheckProfileId] = createSignal("");
  const [checkRightCode, setCheckRightCode] = createSignal("");
  const [checkScopeType, setCheckScopeType] = createSignal<ScopeType>("global");
  const [checkScopeId, setCheckScopeId] = createSignal("");
  const [checkResult, setCheckResult] = createSignal<boolean | null>(null);
  const runCheck = async () => {
    if (!checkProfileId() || !checkRightCode()) return;
    try { setCheckResult(await platformApi.checkRight(checkProfileId(), checkRightCode(), checkScopeType(), checkScopeType() === "global" ? null : (checkScopeId() || null))); }
    catch (e) { setError(String(e)); }
  };

  // --- Custom Fields editor ----------------------------------------------------
  const [cfEntityType, setCfEntityType] = createSignal(CF_ENTITY_TYPES[0]);
  const [cfDefs, { refetch: reloadCfDefs }] = createResource(cfEntityType, (t) => platformApi.cfDefinitions(t));
  const [cfForm, setCfForm] = createSignal(blankCf());
  const saveCfDefinition = async () => {
    const f = cfForm();
    if (!f.name.trim()) { setError("Custom field name is required."); return; }
    try {
      let constraints_json: string | null = null;
      if ((f.cf_type === "enum" || f.cf_type === "enum_list")) {
        const options = f.constraints.split(",").map(s => s.trim()).filter(Boolean);
        if (options.length === 0) throw new Error("Enum fields need comma-separated options.");
        constraints_json = JSON.stringify({ options });
      } else if (f.constraints.trim()) {
        constraints_json = f.constraints.trim();
      }
      await platformApi.createCfDefinition({ entity_type: cfEntityType(), cf_type: f.cf_type, name: f.name.trim(), constraints_json });
      setCfForm(blankCf()); reloadCfDefs();
    } catch (e) { setError(String(e)); }
  };
  const toggleArchiveCf = async (d: CfDefinition) => { try { await platformApi.archiveCfDefinition(d.id, !d.archived); reloadCfDefs(); } catch (e) { setError(String(e)); } };

  return <section class="admin-view">
    <PageHeader icon="settings" title="Admin" subline="Roles, rights and the operator tools behind this workspace." chips={<Show when={seeded()}><Chip value={seeded()} label="rights seeded" /></Show>} />
    <Show when={error()}><p class="admin-error">{error()}</p></Show>

    <div class="admin-grid">
      <section class="admin-panel">
        <div class="panel-title"><h2>Roles</h2></div>
        <form class="inline-form-col op-form" onSubmit={saveRole}>
          <input class="op-input op-grow" aria-label="New role name" placeholder="New role name" value={roleForm().name} onInput={e => setRoleForm({ ...roleForm(), name: e.currentTarget.value })} />
          <button class="primary">Add role</button>
        </form>
        {/* A ROLE LIST IS A PAGE-FILLING PANEL, so it gets a real empty state.
            The form that fixes it is one line above and already focused-able,
            so the action points at the form instead of describing where it is. */}
        <Show when={!roles.loading && roles()?.length === 0}>
          <EmptyState
            title="No roles yet"
            hint="A role is a named bundle of rights. People and teams are granted roles, never single rights."
            actions={<button class="primary" type="button" onClick={() => document.querySelector<HTMLInputElement>('.admin-view input[aria-label="New role name"]')?.focus()}>Add the first role</button>}
          />
        </Show>
        <ul class="entity-list compact"><For each={roles()}>{r =>
          <li classList={{ active: selectedRole()?.id === r.id, archived: r.archived }} onClick={() => setSelectedRole(r)}>
            <div><strong>{r.name}</strong><span class="muted">{r.role_type}</span></div>
            <GhostPill class="small" onClick={(ev: MouseEvent) => { ev.stopPropagation(); toggleArchiveRole(r); }}>{r.archived ? "Restore" : "Archive"}</GhostPill>
          </li>
        }</For></ul>
      </section>

      <section class="admin-panel rights-matrix">
        <div class="panel-title"><h2>Rights matrix</h2></div>
        {/* NOT an empty store — a missing SELECTION. There is nothing to create
            here, so no action is drawn: a button that cannot do the thing is a
            worse empty state than an empty one. */}
        <Show when={selectedRole()} fallback={<EmptyState variant="no-match" title="No role selected" hint="Pick a role on the left to see and edit the rights it carries." />}>
          {role => <>
            <p class="muted">{role().name}</p>
            <div class="matrix-groups"><For each={groupedRights()}>{([type, list]) =>
              <div class="matrix-group"><h3>{type}</h3><For each={list}>{right =>
                <label class="matrix-row"><input type="checkbox" checked={(roleRightCodes() ?? []).includes(right.code)} onChange={() => toggleRight(right.code)} /><span>{right.title}</span><code>{right.code}</code>
                  <Show when={right.propagation === "NONE"}><span class="muted">exact scope only</span></Show>
                  <Show when={right.feature_gate}>{gate => <span class="muted">feature: {gate()}</span>}</Show>
                </label>
              }</For></div>
            }</For></div>
          </>}
        </Show>
      </section>

      <section class="admin-panel">
        <div class="panel-title"><h2>Role assignments</h2></div>
        {/* THE GRANT ROW. This form STAYS on the surface: Admin is an operator
            tool and an administrator grants many roles in a row — a drawer would
            cost a click per repetition (L3 relaxed). What is not relaxed is L4:
            four pickers and a field now share one height and one radius, so the
            row reads as one line instead of five stacked boxes with words
            floating above them. */}
        <div class="inline-form-col op-form">
          <PillSelect label="Grant to" value={targetKind()} onChange={value => { setTargetKind(value as "profile" | "team"); setTargetId(""); }}>
            <option value="profile">Assign to profile</option><option value="team">Assign to team</option>
          </PillSelect>
          <PillSelect label={targetKind() === "profile" ? "Profile" : "Team"} value={targetId()} onChange={setTargetId}>
            <option value="">Choose {targetKind()}…</option>
            <For each={targetKind() === "profile" ? profiles() : teams()}>{t => <option value={t.id}>{"display_name" in t ? t.display_name : t.name}</option>}</For>
          </PillSelect>
          <PillSelect label="Role" value={assignRoleId()} onChange={setAssignRoleId}>
            <option value="">Choose role…</option><For each={roles()}>{r => <option value={r.id}>{r.name}</option>}</For>
          </PillSelect>
          <PillSelect label="Scope" value={scopeType()} onChange={value => setScopeType(value as ScopeType)}>
            <For each={SCOPE_TYPES}>{s => <option value={s}>{scopeLabel(s)}</option>}</For>
          </PillSelect>
          <Show when={scopeType() !== "global"}><input class="op-input op-grow" aria-label="Scope id" placeholder="Scope id (e.g. project id)" value={scopeId()} onInput={e => setScopeId(e.currentTarget.value)} /></Show>
          <button class="primary" onClick={createAssignment}>Grant</button>
        </div>
        <ul class="entity-list"><For each={assignments()}>{a =>
          <li><div><strong>{roleName(a.role_id)}</strong><span class="muted">{targetLabel(a)} · {scopeLabel(a.scope_type as ScopeType)}{a.scope_id ? ` ${a.scope_id}` : ""}</span></div><GhostPill onClick={() => removeAssignment(a)}>Revoke</GhostPill></li>
        }</For></ul>
        <Show when={assignments()?.length === 0}>
          <EmptyState title="Nobody has been granted a role yet" hint="Until a role is granted, everyone has only the rights their account type gives them." />
        </Show>

        <div class="panel-title"><h2>Check right</h2></div>
        <div class="inline-form-col op-form">
          <PillSelect label="Profile to check" value={checkProfileId()} onChange={setCheckProfileId}><option value="">Profile…</option><For each={profiles()}>{p => <option value={p.id}>{p.display_name}</option>}</For></PillSelect>
          <PillSelect label="Right to check" value={checkRightCode()} onChange={setCheckRightCode}><option value="">Right…</option><For each={rights()}>{r => <option value={r.code}>{r.code}</option>}</For></PillSelect>
          <PillSelect label="Scope to check" value={checkScopeType()} onChange={value => setCheckScopeType(value as ScopeType)}><For each={SCOPE_TYPES}>{s => <option value={s}>{scopeLabel(s)}</option>}</For></PillSelect>
          <Show when={checkScopeType() !== "global"}><input class="op-input" aria-label="Scope id to check" placeholder="Scope id" value={checkScopeId()} onInput={e => setCheckScopeId(e.currentTarget.value)} /></Show>
          <GhostPill onClick={runCheck}>Check</GhostPill>
          {/* GRANTED/DENIED is the answer to a question the operator just asked,
              so it is a result pill, not a status: teal reads "open/allowed",
              red reads "blocked". Nothing else on this row carries colour. */}
          <Show when={checkResult() !== null}><span class="paper-pill" classList={{ teal: checkResult() === true, red: checkResult() === false }}>{checkResult() ? "Granted" : "Denied"}</span></Show>
        </div>
      </section>

      <section class="admin-panel">
        <div class="panel-title"><h2>Custom fields</h2></div>
        <div class="cf-tabs"><For each={CF_ENTITY_TYPES}>{t => <button classList={{ active: cfEntityType() === t }} onClick={() => setCfEntityType(t)}>{cfLabel(t)}</button>}</For></div>
        <div class="inline-form-col op-form">
          <input class="op-input op-grow" aria-label="Field name" placeholder="Field name" value={cfForm().name} onInput={e => setCfForm({ ...cfForm(), name: e.currentTarget.value })} />
          <PillSelect label="Field type" value={cfForm().cf_type} onChange={value => setCfForm({ ...cfForm(), cf_type: value as CfType })}><For each={CF_TYPES}>{t => <option value={t}>{cfTypeLabel(t)}</option>}</For></PillSelect>
          <Show when={(cfForm().cf_type === "enum" || cfForm().cf_type === "enum_list")}><input class="op-input op-grow" aria-label="Enum options" placeholder="Comma-separated options" value={cfForm().constraints} onInput={e => setCfForm({ ...cfForm(), constraints: e.currentTarget.value })} /></Show>
          <Show when={cfForm().cf_type === "int" || cfForm().cf_type === "text"}><input class="op-input op-grow" aria-label="Constraints JSON" placeholder='Constraints JSON e.g. {"min":0,"max":100}' value={cfForm().constraints} onInput={e => setCfForm({ ...cfForm(), constraints: e.currentTarget.value })} /></Show>
          <button class="primary" onClick={saveCfDefinition}>Add field</button>
        </div>
        <ul class="entity-list"><For each={cfDefs()}>{d =>
          <li classList={{ archived: d.archived }}><div><strong>{d.name}</strong><span class="muted">{cfTypeLabel(d.cf_type)}{d.constraints_json ? ` · ${d.constraints_json}` : ""}</span></div><GhostPill onClick={() => toggleArchiveCf(d)}>{d.archived ? "Restore" : "Archive"}</GhostPill></li>
        }</For></ul>
        {/* The old line named the internal entity key — it said `issue` while
            every other surface in the app says ticket. `cfLabel` is the display
            name and already existed; it was simply not used here. */}
        <Show when={cfDefs()?.length === 0}>
          <EmptyState title={`No custom fields on a ${cfLabel(cfEntityType())} yet`} hint="A custom field adds one extra column of your own to every record of this kind." />
        </Show>
      </section>
    </div>
  </section>;
}
