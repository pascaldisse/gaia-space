import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import {
  personalApi,
  type Absence,
  type AbsenceAvailability,
} from "../api/personal";
import { platformApi, type CfDefinition } from "../api/platform";
import { Icon } from "../components/Icon";
import { ProfilePicker } from "../components/Pickers";
import DateField from "../components/DateField";
import PageHeader from "../components/PageHeader";
import { MetricGrid, MetricTile } from "../components/blocks";
import { metricTone } from "../statusTone";
import EmptyState from "../components/EmptyState";
import {
  currentUser,
  humanError,
  isWeb,
  profileId as sessionProfile,
  profiles as sessionProfiles,
} from "../session";
import "./Absences.css";
import { UI_LOCALE } from "../calendar";

const leaveTypes = [
  "Vacation",
  "Sick leave",
  "Personal",
  "Parental",
  "Public holiday",
  "Unpaid",
  "Remote",
];
const emptyAbsence = () => ({
  profile_id: sessionProfile(),
  reason_type: "",
  date_from: "",
  date_to: "",
  approved: false,
  reason_confidential: false,
  availability: "away" as AbsenceAvailability,
});
const availabilityLabels: Record<string, string> = {
  away: "Not available",
  partial: "Partly available",
  available: "Available elsewhere",
};
const dateKey = () => new Date().toISOString().slice(0, 10);

function statusFor(absence: Absence) {
  const today = dateKey();
  if (absence.date_to && absence.date_to < today)
    return { key: "past", label: "Past" };
  if (absence.date_from && absence.date_from > today)
    return { key: "upcoming", label: "Upcoming" };
  return { key: "current", label: "Away now" };
}

function dateRange(from: string, to: string) {
  const format = (value: string) =>
    value
      ? new Date(`${value}T00:00:00`).toLocaleDateString(UI_LOCALE, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";
  return from === to ? format(from) : `${format(from)} → ${format(to)}`;
}

export default function Absences() {
  const [filterProfileId, setFilterProfileId] = createSignal("");
  const [draft, setDraft] = createSignal(emptyAbsence());
  const [message, setMessage] = createSignal("");
  const [formOpen, setFormOpen] = createSignal(false);
  const [customValues, setCustomValues] = createSignal<Record<string, string>>({});
  const [customFields] = createResource<CfDefinition[]>(() => platformApi.cfDefinitions("absence"));
  const [records, { refetch }] = createResource(filterProfileId, (id) =>
    personalApi.absences(id || undefined),
  );

  /** True while the empty branch below draws its own "Record time off". */
  const showsEmptyPrimary = () => !records.loading && allRecords().length === 0;

  const allRecords = createMemo(() =>
    [...(records() ?? [])].sort((left, right) =>
      right.date_from.localeCompare(left.date_from),
    ),
  );
  const current = createMemo(() =>
    allRecords().filter((item) => statusFor(item).key === "current"),
  );
  const upcoming = createMemo(() =>
    allRecords().filter((item) => statusFor(item).key === "upcoming"),
  );
  const pending = createMemo(() =>
    allRecords().filter((item) => !item.approved),
  );
  const displayName = (id: string) =>
    sessionProfiles()?.find((profile) => profile.id === id)?.display_name ?? id;
  const mayApprove = () => !isWeb() || currentUser()?.role === "GlobalAdmin";

  const openForm = () => {
    setDraft({
      ...emptyAbsence(),
      profile_id: filterProfileId() || sessionProfile(),
    });
    setCustomValues({});
    setFormOpen(true);
  };
  const dismissForm = () => setFormOpen(false);
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    const value = draft();
    const profile_id = value.profile_id.trim() || sessionProfile().trim();
    try {
      if (
        !profile_id ||
        !value.reason_type.trim() ||
        !value.date_from ||
        !value.date_to
      )
        throw new Error("Person, reason, and both dates are required.");
      if (value.date_to < value.date_from)
        throw new Error("The end date can’t be before the start date.");
      const created = await personalApi.createAbsence({
        ...value,
        profile_id,
        reason_type: value.reason_type.trim(),
      });
      await Promise.all(Object.entries(customValues()).filter(([, raw]) => raw.trim()).map(([definition_id, raw]) => platformApi.cfSetValue(definition_id, created.id, raw)));
      setDraft(emptyAbsence());
      setMessage("");
      dismissForm();
      refetch();
    } catch (error) {
      setMessage(humanError(error));
    }
  };
  const revise = async (absence: Absence, patch: Partial<Absence>) => {
    try {
      await personalApi.updateAbsence({ ...absence, ...patch });
      setMessage("");
      refetch();
    } catch (error) {
      setMessage(humanError(error));
    }
  };
  const discard = async (id: string) => {
    try {
      await personalApi.deleteAbsence(id);
      setMessage("");
      refetch();
    } catch (error) {
      setMessage(humanError(error));
    }
  };

  return (
    <section class="timeoff-view">
      <PageHeader
        icon="clock"
        title="Time off"
        subline="Who is away, when, and what is still waiting for approval."
      />
      <nav class="page-actionbar" aria-label="Time off actions">
        {/* ONE ACTION, ONE PLACE: while the empty state carries this same act,
            the row does not draw it a second time. Same rule as the task
            surfaces (src/views/one-action-one-place.test.tsx). */}
        <Show when={!showsEmptyPrimary()}>
          <button type="button" class="primary" onClick={openForm}>
            <Icon name="plus" size={15} /> Record time off
          </button>
        </Show>
        {/* A filter, not an identity: it changes whose time off you see, so it sits
            at the far end of the row as a pill whose value is its own label. */}
        <span class="actionbar-view-controls">
          <ProfilePicker
            label="Show time off for"
            labelHidden
            value={filterProfileId()}
            onChange={setFilterProfileId}
            allowAll
          />
        </span>
      </nav>

      <Show when={message()}>
        <p class="timeoff-error" onClick={() => setMessage("")}>
          {message()}
        </p>
      </Show>
      <Show when={formOpen()}>
        <form class="timeoff-form" onSubmit={save}>
          <div class="timeoff-form-head">
            <h2>Record time off</h2>
            <button
              type="button"
              class="ghost"
              onClick={dismissForm}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div class="timeoff-form-grid">
            <label class="fld">
              Person
              <div class="fld-picker">
                <ProfilePicker
                  label=""
                  value={draft().profile_id || sessionProfile()}
                  onChange={(profile_id) =>
                    setDraft({ ...draft(), profile_id })
                  }
                />
              </div>
            </label>
            <label class="fld">
              Type
              <input
                list="leave-types"
                placeholder="e.g. Vacation"
                value={draft().reason_type}
                onInput={(event) =>
                  setDraft({
                    ...draft(),
                    reason_type: event.currentTarget.value,
                  })
                }
              />
              <datalist id="leave-types">
                <For each={leaveTypes}>{(type) => <option value={type} />}</For>
              </datalist>
            </label>
            {/* Captions stay; the wrappers become divs, because a <label> may not
                wrap a button that opens the product's own month grid. Leave is a
                span with two ends, so neither end offers Clear. */}
            <div class="fld">
              <span>From</span>
              <DateField
                label="From"
                clearable={false}
                value={draft().date_from}
                onChange={(value) => setDraft({ ...draft(), date_from: value })}
              />
            </div>
            <div class="fld">
              <span>To</span>
              <DateField
                label="To"
                clearable={false}
                value={draft().date_to}
                onChange={(value) => setDraft({ ...draft(), date_to: value })}
              />
            </div>
          </div>
          <div class="timeoff-form-grid">
            <label class="fld">
              Availability
              <select
                value={draft().availability}
                onChange={(event) =>
                  setDraft({
                    ...draft(),
                    availability: event.currentTarget
                      .value as AbsenceAvailability,
                  })
                }
              >
                <option value="away">Not available</option>
                <option value="partial">Partly available</option>
                <option value="available">Available elsewhere</option>
              </select>
            </label>
            <label class="fld-check">
              <input
                type="checkbox"
                checked={draft().reason_confidential}
                onChange={(event) =>
                  setDraft({
                    ...draft(),
                    reason_confidential: event.currentTarget.checked,
                  })
                }
              />{" "}
              Keep the reason private (colleagues see only the availability)
            </label>
          </div>
          <Show when={customFields()?.length}><div class="timeoff-form-grid" aria-label="Custom fields"><For each={customFields()}>{field => <label class="fld">{field.name}<input placeholder="JSON value" value={customValues()[field.id] ?? ""} onInput={event => setCustomValues({ ...customValues(), [field.id]: event.currentTarget.value })}/></label>}</For></div></Show>
          <div class="timeoff-form-foot">
            <Show when={mayApprove()}>
              <label class="fld-check">
                <input
                  type="checkbox"
                  checked={draft().approved}
                  onChange={(event) =>
                    setDraft({
                      ...draft(),
                      approved: event.currentTarget.checked,
                    })
                  }
                />{" "}
                Already approved
              </label>
            </Show>
            <div class="timeoff-form-actions">
              <button type="button" class="ghost" onClick={dismissForm}>
                Cancel
              </button>
              <button class="primary">Save time off</button>
            </div>
          </div>
        </form>
      </Show>

      <Show
        when={records.loading || allRecords().length > 0}
        fallback={
          <div class="view-cols timeoff-cols timeoff-onboarding">
            <div class="view-main">
              {/* ONE EMPTY STATE, NOT FOUR (stage 11, defect 6b). This branch used
                  to render the AvailabilityBoard as well, so an empty workspace
                  said "nothing here" FOUR times: three status cards ('Everyone is
                  currently available', 'No upcoming time off is recorded',
                  'Everything is approved') and then the dashed empty state under
                  them. The board is a SUMMARY OF RECORDS — with no records it has
                  nothing to summarise, so it belongs to the populated branch
                  below, where it still renders the moment one record exists. What
                  survives here is the one empty state that carries the primary
                  action, which is the only thing this screen can honestly offer. */}
              {/* NOTHING YET, and the action is the real one this view owns:
                  `openForm` opens the record dialog, already scoped to whichever
                  person the filter names — it never re-asks. */}
              <EmptyState
                icon={<Icon name="clock-nav" size={20} />}
                title={filterProfileId()
                  ? `No time off recorded for ${displayName(filterProfileId())} yet`
                  : "No time off recorded yet"}
                hint="Vacations, sick days and other leave — so everyone can see who is available."
                actions={<button type="button" class="primary" onClick={openForm}>Record time off</button>}
              />
            </div>
            {/* NO RAIL WHILE THERE IS NOTHING TO SUMMARISE. "0 Away now · 0 Pending ·
                0 Upcoming" beside "No time off recorded yet" says the same absence a
                second time, and having a rail at all pushed the one real action into
                the middle of an empty page. The rail returns with the first record. */}
          </div>
        }
      >
        <Show when={records.loading}>
          <p class="timeoff-loading">Loading…</p>
        </Show>
        <div class="view-cols timeoff-cols">
          <div class="view-main">
            <AvailabilityBoard
              current={current()}
              upcoming={upcoming()}
              pending={pending()}
              nameFor={displayName}
              onApprove={(absence) => revise(absence, { approved: true })}
            />
            <section class="timeoff-records">
              <div class="timeoff-records-head">
                <h2>All time off</h2>
                <span>{allRecords().length} records</span>
              </div>
              <ul class="timeoff-list">
                <For each={allRecords()}>
                  {(absence) => {
                    const status = statusFor(absence);
                    return (
                      <li
                        class="timeoff-row"
                        classList={{
                          [`is-${status.key}`]: true,
                          past: status.key === "past",
                        }}
                      >
                        <span
                          class="timeoff-phase-rail"
                          data-phase={status.key}
                        />
                        <div class="timeoff-row-main">
                          <div class="timeoff-row-top">
                            <strong class="timeoff-reason">
                              {absence.reason_type}
                            </strong>
                            <span class="pill">
                              {availabilityLabels[absence.availability] ??
                                absence.availability}
                            </span>
                            <span
                              class="pill"
                              classList={{ [`pill-${status.key}`]: true }}
                            >
                              {status.label}
                            </span>
                            <span
                              class="pill"
                              classList={{
                                "pill-approved": absence.approved,
                                "pill-pending": !absence.approved,
                              }}
                            >
                              {absence.approved ? "Approved" : "Pending"}
                            </span>
                          </div>
                          <div class="timeoff-row-meta">
                            <span class="timeoff-person">
                              {displayName(absence.profile_id)}
                            </span>
                            <span class="dot">·</span>
                            <time>
                              {dateRange(absence.date_from, absence.date_to)}
                            </time>
                          </div>
                        </div>
                        <div class="timeoff-row-actions">
                          <Show when={mayApprove()}>
                            <button
                              class="ghost small"
                              classList={{ active: absence.approved }}
                              onClick={() =>
                                revise(absence, { approved: !absence.approved })
                              }
                            >
                              {absence.approved ? "Revoke" : "Approve"}
                            </button>
                          </Show>
                          <button
                            class="ghost small danger"
                            onClick={() => discard(absence.id)}
                            aria-label="Delete record"
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </section>
          </div>
          <Show when={allRecords().length}>
            <aside class="view-rail timeoff-rail">
              <OverviewRail
                current={current().length}
                pending={pending().length}
                upcoming={upcoming().length}
                total={allRecords().length}
              />
              <div class="rail-card">
                <h3>
                  Needs approval
                  <span class="rail-count">{pending().length}</span>
                </h3>
                <Show
                  when={pending().length}
                  fallback={<p class="rail-empty">Everything's approved.</p>}
                >
                  <div class="rail-rows">
                    <For each={pending().slice(0, 6)}>
                      {(absence) => (
                        <div class="rail-item">
                          <span class="rail-item-title">
                            {displayName(absence.profile_id)}
                          </span>
                          <span class="rail-item-sub">
                            {absence.reason_type} ·{" "}
                            {dateRange(absence.date_from, absence.date_to)}
                          </span>
                          <Show when={mayApprove()}>
                            <div class="rail-item-act">
                              <button
                                class="ghost small"
                                onClick={() =>
                                  revise(absence, { approved: true })
                                }
                              >
                                Approve
                              </button>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </aside>
          </Show>
        </div>
      </Show>
    </section>
  );
}

function AvailabilityBoard(props: {
  current: Absence[];
  upcoming: Absence[];
  pending: Absence[];
  nameFor: (id: string) => string;
  onApprove?: (absence: Absence) => void;
}) {
  /* THE ZERO RULE, BEYOND CHIPS (stage 11, defect 3). Each panel used to carry a
     coloured 3px top border unconditionally, so on an empty workspace three
     cards shouted about nothing and `Needs approval 0` read amber. The tone is
     now computed the one way the app computes tone — statusTone.metricTone — so
     a count of 0 arrives untoned and the accent simply does not exist.

     The colour law also decides WHICH tone each panel may claim:
       · Away now      → teal. People are out; that is the open, actionable fact.
       · Coming up     → no tone. A future date is not urgent, and colouring it
                          would spend a colour on the calmest thing on screen.
       · Needs approval→ amber. It is WAITING on somebody, which is exactly what
                          amber means. It was --status-info-ink, a fourth colour
                          the law does not have. */
  const panels = () => [
    {
      className: "now",
      title: "Away now",
      records: props.current,
      tone: metricTone(props.current.length, "teal"),
      empty: "Everyone is currently available.",
    },
    {
      className: "upcoming",
      title: "Coming up",
      records: props.upcoming,
      tone: "" as const,
      empty: "No upcoming time off is recorded.",
    },
    {
      className: "pending",
      title: "Needs approval",
      records: props.pending,
      tone: metricTone(props.pending.length, "amber"),
      empty: "Everything is approved.",
    },
  ];
  return (
    <section class="availability-board" aria-label="Availability at a glance">
      <For each={panels()}>
        {(panel) => (
          <div class={`availability-panel ${panel.className}${panel.tone ? ` ${panel.tone}` : ""}`}>
            <div class="availability-panel-head">
              <h2>{panel.title}</h2>
              <span>{panel.records.length}</span>
            </div>
            <Show when={panel.records.length} fallback={<p>{panel.empty}</p>}>
              <ul>
                <For each={panel.records.slice(0, 4)}>
                  {(absence) => (
                    <li>
                      <div>
                        <strong>{props.nameFor(absence.profile_id)}</strong>
                        <span>
                          {absence.reason_type} ·{" "}
                          {dateRange(absence.date_from, absence.date_to)}
                        </span>
                      </div>
                      <Show
                        when={panel.className === "pending" && props.onApprove}
                      >
                        <button
                          class="ghost small"
                          onClick={() => props.onApprove?.(absence)}
                        >
                          Approve
                        </button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        )}
      </For>
    </section>
  );
}

function OverviewRail(props: {
  current: number;
  pending: number;
  upcoming: number;
  total?: number;
}) {
  return (
    <div class="rail-card">
      {/* A section heading, not a shouted kicker with a clock glued to it. */}
      <h3>Overview</h3>
      {/* ONE TILE FOR THE WHOLE APP (defect 2): `.rail-metric` was this view's own
          shape. `pairs` is the rail's two-column form of the same block. Tone is
          decided inside MetricTile by metricTone, so every one of these is quiet
          while the workspace is empty. */}
      <MetricGrid label="Time off overview" class="pairs">
        <MetricTile value={props.current} label="Away now" tone="teal" />
        <MetricTile value={props.pending} label="Pending" tone="amber" />
        <MetricTile value={props.upcoming} label="Upcoming" />
        <Show when={props.total !== undefined}>
          <MetricTile value={props.total} label="Total" />
        </Show>
      </MetricGrid>
    </div>
  );
}
