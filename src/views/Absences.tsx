import { createResource, createSignal, createMemo, For, Show } from "solid-js";
import { personalApi, type Absence } from "../api/personal";
import "./Absences.css";
import { ProfilePicker } from "../components/Pickers";
import { Icon } from "../components/Icon";
import { humanError, profileId as sessionProfile, profiles as sessionProfiles } from "../session";

// Common leave categories offered as quick suggestions. reason_type stays a
// free-text field on the model, so owners can still type anything.
const LEAVE_TYPES = ["Vacation", "Sick leave", "Personal", "Parental", "Public holiday", "Unpaid", "Remote"];

const blank = () => ({ profile_id: sessionProfile(), reason_type: "", date_from: "", date_to: "", approved: false });

const todayKey = () => new Date().toISOString().slice(0, 10);

// Timeline bucket for an entry relative to today — drives the status pill.
function phaseOf(a: Absence): { key: "current" | "upcoming" | "past"; label: string } {
  const today = todayKey();
  if (a.date_to && a.date_to < today) return { key: "past", label: "Past" };
  if (a.date_from && a.date_from > today) return { key: "upcoming", label: "Upcoming" };
  return { key: "current", label: "Away now" };
}

function fmtRange(from: string, to: string) {
  const f = (d: string) => (d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
  return from === to ? f(from) : `${f(from)} → ${f(to)}`;
}

export default function Absences() {
  const [profileId, setProfileId] = createSignal("");
  const [form, setForm] = createSignal(blank());
  const [error, setError] = createSignal("");
  const [showForm, setShowForm] = createSignal(false);
  const [absences, { refetch }] = createResource(profileId, (id) => personalApi.absences(id || undefined));

  const personName = (id: string) => sessionProfiles()?.find((p) => p.id === id)?.display_name ?? id;

  // Sort newest-start first so upcoming/current time off sits at the top.
  const sorted = createMemo(() => [...(absences() ?? [])].sort((a, b) => (b.date_from ?? "").localeCompare(a.date_from ?? "")));
  const awayList = createMemo(() => sorted().filter((a) => phaseOf(a).key === "current"));
  const upcomingList = createMemo(() => sorted().filter((a) => phaseOf(a).key === "upcoming"));
  const pendingList = createMemo(() => sorted().filter((a) => !a.approved));
  const awayNow = createMemo(() => awayList().length);
  const pending = createMemo(() => pendingList().length);

  const openForm = () => { setForm({ ...blank(), profile_id: profileId() || sessionProfile() }); setShowForm(true); };

  const save = async (e: SubmitEvent) => {
    e.preventDefault();
    try {
      const f = form();
      if (!f.profile_id.trim() || !f.reason_type.trim() || !f.date_from || !f.date_to)
        throw new Error("Person, reason, and both dates are required.");
      if (f.date_to < f.date_from) throw new Error("The end date can’t be before the start date.");
      await personalApi.createAbsence({ ...f, profile_id: f.profile_id.trim(), reason_type: f.reason_type.trim() });
      setForm(blank());
      setShowForm(false);
      setError("");
      refetch();
    } catch (reason) { setError(humanError(reason)); }
  };
  const update = async (absence: Absence, patch: Partial<Absence>) => {
    try { await personalApi.updateAbsence({ ...absence, ...patch }); refetch(); }
    catch (reason) { setError(humanError(reason)); }
  };
  const remove = async (id: string) => {
    try { await personalApi.deleteAbsence(id); refetch(); }
    catch (reason) { setError(humanError(reason)); }
  };

  return (
    <section class="timeoff-view">
      <header class="timeoff-head">
        <div class="timeoff-head-main">
          <div class="timeoff-mark" aria-hidden="true"><Icon name="clock-nav" size={22} /></div>
          <div>
            <h1>Time off</h1>
            <p>
              Plan and track leave across your organization — who’s <strong>away now</strong>,
              what’s <strong>coming up</strong>, and which requests still need approval.
            </p>
          </div>
        </div>
        <div class="timeoff-head-side">
          <ProfilePicker label="Show time off for" value={profileId()} onChange={setProfileId} allowAll />
          <button class="primary timeoff-new" onClick={openForm}><Icon name="plus" size={15} /> Record time off</button>
        </div>
      </header>

      <Show when={error()}><p class="timeoff-error" onClick={() => setError("")}>{error()}</p></Show>

      <Show when={showForm()}>
        <form class="timeoff-form" onSubmit={save}>
          <div class="timeoff-form-head"><h2>Record time off</h2><button type="button" class="ghost" onClick={() => setShowForm(false)} aria-label="Close">×</button></div>
          <div class="timeoff-form-grid">
            <label class="fld">Person
              <div class="fld-picker"><ProfilePicker label="" value={form().profile_id || sessionProfile()} onChange={(id) => setForm({ ...form(), profile_id: id })} /></div>
            </label>
            <label class="fld">Type
              <input list="leave-types" placeholder="e.g. Vacation" value={form().reason_type} onInput={(e) => setForm({ ...form(), reason_type: e.currentTarget.value })} />
              <datalist id="leave-types"><For each={LEAVE_TYPES}>{(t) => <option value={t} />}</For></datalist>
            </label>
            <label class="fld">From
              <input type="date" value={form().date_from} onInput={(e) => setForm({ ...form(), date_from: e.currentTarget.value })} />
            </label>
            <label class="fld">To
              <input type="date" value={form().date_to} onInput={(e) => setForm({ ...form(), date_to: e.currentTarget.value })} />
            </label>
          </div>
          <div class="timeoff-form-foot">
            <label class="fld-check"><input type="checkbox" checked={form().approved} onChange={(e) => setForm({ ...form(), approved: e.currentTarget.checked })} /> Already approved</label>
            <div class="timeoff-form-actions">
              <button type="button" class="ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button class="primary">Save time off</button>
            </div>
          </div>
        </form>
      </Show>

      <Show
        when={absences.loading || sorted().length > 0}
        fallback={
          <div class="timeoff-empty">
            <div class="timeoff-empty-card">
              <div class="timeoff-empty-icon" aria-hidden="true"><Icon name="clock-nav" size={26} /></div>
              <h2>No time off recorded yet</h2>
              <p>
                Keep a clear picture of availability by logging vacations, sick days, and other
                leave{profileId() ? ` for ${personName(profileId())}` : " across the organization"}.
              </p>
              <button class="primary timeoff-empty-cta" onClick={openForm}><Icon name="plus" size={15} /> Record time off</button>
            </div>
          </div>
        }
      >
        <Show when={absences.loading}><p class="timeoff-loading">Loading…</p></Show>
        <div class="view-cols timeoff-cols"><div class="view-main">
        <ul class="timeoff-list">
          <For each={sorted()}>{(a) => {
            const phase = phaseOf(a);
            return (
              <li class="timeoff-row" classList={{ [`is-${phase.key}`]: true, past: phase.key === "past" }}>
                <span class="timeoff-phase-rail" data-phase={phase.key} aria-hidden="true" />
                <div class="timeoff-row-main">
                  <div class="timeoff-row-top">
                    <strong class="timeoff-reason">{a.reason_type}</strong>
                    <span class="pill" classList={{ [`pill-${phase.key}`]: true }}>{phase.label}</span>
                    <span class="pill" classList={{ "pill-approved": a.approved, "pill-pending": !a.approved }}>{a.approved ? "Approved" : "Pending"}</span>
                  </div>
                  <div class="timeoff-row-meta">
                    <span class="timeoff-person">{personName(a.profile_id)}</span>
                    <span class="dot">·</span>
                    <time>{fmtRange(a.date_from, a.date_to)}</time>
                  </div>
                </div>
                <div class="timeoff-row-actions">
                  <button class="ghost small" classList={{ active: a.approved }} onClick={() => update(a, { approved: !a.approved })}>
                    {a.approved ? "Revoke" : "Approve"}
                  </button>
                  <button class="ghost small danger" title="Delete record" aria-label="Delete record" onClick={() => remove(a.id)}>×</button>
                </div>
              </li>
            );
          }}</For>
        </ul>
        </div>

        <Show when={sorted().length > 0}>
        <aside class="view-rail timeoff-rail">
          <div class="rail-card">
            <h3><Icon name="clock-nav" size={13}/> Overview</h3>
            <div class="rail-metrics">
              <div class="rail-metric accent"><span class="rail-num">{awayNow()}</span><span class="rail-lbl">Away now</span></div>
              <div class="rail-metric warn"><span class="rail-num">{pending()}</span><span class="rail-lbl">Pending</span></div>
              <div class="rail-metric"><span class="rail-num">{upcomingList().length}</span><span class="rail-lbl">Upcoming</span></div>
              <div class="rail-metric"><span class="rail-num">{sorted().length}</span><span class="rail-lbl">Total</span></div>
            </div>
          </div>

          <div class="rail-card">
            <h3>Needs approval<span class="rail-count">{pendingList().length}</span></h3>
            <Show when={pendingList().length} fallback={<p class="rail-empty">Everything's approved.</p>}>
              <div class="rail-rows">
                <For each={pendingList().slice(0, 6)}>{(a) =>
                  <div class="rail-item">
                    <span class="rail-item-title">{personName(a.profile_id)}</span>
                    <span class="rail-item-sub">{a.reason_type} · {fmtRange(a.date_from, a.date_to)}</span>
                    <div class="rail-item-act"><button class="ghost small" onClick={() => update(a, { approved: true })}>Approve</button></div>
                  </div>}</For>
              </div>
            </Show>
          </div>

          <Show when={awayList().length}>
            <div class="rail-card">
              <h3>Away now</h3>
              <div class="rail-rows">
                <For each={awayList().slice(0, 6)}>{(a) =>
                  <div class="rail-row">
                    <span class="rail-row-ic"><Icon name="user" size={13}/></span>
                    <span class="rail-row-label">{personName(a.profile_id)}</span>
                    <span class="rail-row-val">{a.reason_type}</span>
                  </div>}</For>
              </div>
            </div>
          </Show>
        </aside>
        </Show>
        </div>
      </Show>
    </section>
  );
}
