import { createResource, createSignal, For, Show } from "solid-js";
import { platformApi, type DeskAssignment, type Location } from "../api/platform";
import PageHeader, { Chip } from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { GhostPill, PillSelect } from "../components/controls";
import { humanError } from "../session";
import "../components/paper.css";
import "./operatorForm.css";
import "./Locations.css";

/**
 * Locations (`/locations`) — offices, floors and who sits where.
 *
 * WHAT THIS FILE LOOKED LIKE BEFORE, and why that mattered: the whole view was
 * ONE 3600-character JSX line. Not a formatting complaint — it is why the view
 * was the least-migrated surface in the app. Nobody could see, inside that line,
 * that it contained thirteen captions floating to the LEFT of their fields, a
 * `<label>` nested inside another `<label>`, a raw JSON textarea with no
 * explanation, two unexplained 0–1 coordinates, and no empty state at all.
 * The reformat is therefore the first half of the fix, not cosmetics.
 *
 * THE PRODUCT DECISION THIS VIEW IS BUILT ON: these are OPERATOR TOOLS. The
 * person here is an administrator laying out an office, doing the same action
 * many times in a row. So the two creation forms deliberately STAY ON THE
 * SURFACE (law L3 relaxed) — a drawer would cost a click per repetition. What
 * is not relaxed is law L4: the forms must speak the same control language as
 * every filter row in the app, which is what `operatorForm.css` and `PillSelect`
 * are doing here.
 *
 * WHAT IS DELIBERATELY *NOT* FIXED: `work_schedule_json` is still a raw JSON
 * textarea, and map_x/map_y are still two numbers. Inventing a schedule editor
 * or a floor-plan picker is a feature, not a sweep. What they get instead is an
 * honest name and one line saying what the field actually expects — which is
 * the difference between an expert field and a trap.
 */

const blank = (): Location => ({
  id: "",
  name: "",
  location_type: "Office",
  parent_id: null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  work_schedule_json: '{"workdays":[1,2,3,4,5]}',
  channel_id: null,
  archived: false,
  equipment: [],
});

const blankDesk = (): DeskAssignment => ({
  profile_id: "",
  location_id: "",
  seat_label: null,
  map_x: 0.5,
  map_y: 0.5,
  since_date: new Date().toISOString().slice(0, 10),
  till_date: null,
});

export default function Locations() {
  const [locations, { refetch }] = createResource(() => platformApi.locations());
  const [profiles] = createResource(() => platformApi.profiles());
  const [desks, { refetch: refetchDesks }] = createResource(() => platformApi.deskAssignments());

  const [draft, setDraft] = createSignal<Location>(blank());
  const [desk, setDesk] = createSignal<DeskAssignment>(blankDesk());
  const [error, setError] = createSignal("");

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    try {
      await platformApi.saveLocation({ ...draft(), equipment: draft().equipment.filter(Boolean) });
      setDraft(blank());
      await refetch();
    } catch (e) {
      setError(humanError(e));
    }
  };

  /* The two pickers used to carry `required`, and the native form blocked the
     submit. `PillSelect` is a shared component this lane may not change, and it
     does not take `required`, so the SAME guarantee is re-expressed here and on
     the submit button: the check is not weakened, it just now says which field
     is missing instead of popping an anonymous browser bubble. */
  const deskReady = () => !!desk().profile_id && !!desk().location_id;

  const saveDesk = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!deskReady()) {
      setError("Choose both a member and a location before assigning a desk.");
      return;
    }
    try {
      setError("");
      await platformApi.saveDeskAssignment(desk());
      setDesk(blankDesk());
      await refetchDesks();
    } catch (e) {
      setError(humanError(e));
    }
  };

  const removeDesk = async (id: string) => {
    try {
      await platformApi.removeDeskAssignment(id);
      await refetchDesks();
    } catch (e) {
      setError(humanError(e));
    }
  };

  const personName = (id: string) =>
    profiles()?.find((profile) => profile.id === id)?.display_name ?? id;
  const locationName = (id: string) =>
    locations()?.find((location) => location.id === id)?.name ?? id;

  return (
    <section class="settings-view locations-view">
      <PageHeader
        title="Locations"
        chips={
          <Show when={(locations() ?? []).length}>
            <Chip value={(locations() ?? []).length} label="locations" />
          </Show>
        }
      />

      <Show when={error()}>
        <p class="meeting-error">{error()}</p>
      </Show>

      <div class="settings-grid locations-grid">
        {/* ── the location itself ─────────────────────────────────────────── */}
        <form class="settings-card paper-card" onSubmit={save}>
          <h2 class="paper-section-label">{draft().id ? "Edit location" : "New location"}</h2>

          <div class="op-form">
            {/* Name / Type / Timezone are self-evident once the placeholder says
                the word, so they carry no caption — the caption was the noise. */}
            <input
              class="op-input op-grow"
              aria-label="Location name"
              placeholder="Location name"
              required
              value={draft().name}
              onInput={(event) => setDraft({ ...draft(), name: event.currentTarget.value })}
            />
            <input
              class="op-input"
              aria-label="Location type"
              placeholder="Office, Floor, Room…"
              value={draft().location_type}
              onInput={(event) => setDraft({ ...draft(), location_type: event.currentTarget.value })}
            />
            <input
              class="op-input"
              aria-label="Timezone"
              placeholder="Europe/Berlin"
              required
              value={draft().timezone}
              onInput={(event) => setDraft({ ...draft(), timezone: event.currentTarget.value })}
            />
            <input
              class="op-input op-grow"
              aria-label="Equipment"
              placeholder="Equipment, comma-separated"
              value={draft().equipment.join(", ")}
              onInput={(event) =>
                setDraft({
                  ...draft(),
                  equipment: event.currentTarget.value.split(",").map((x) => x.trim()).filter(Boolean),
                })
              }
            />
          </div>

          {/* THE ONE FIELD THAT KEEPS ITS CAPTION. A text input's placeholder can
              be its name only when the answer is obvious; here the answer is a
              JSON object with a specific shape, so it gets a real label and one
              line of truth about what it expects. No schedule editor is being
              invented — that is a feature, and out of this lane's scope. */}
          <label class="op-field locations-schedule">
            <span>Work schedule</span>
            <textarea
              class="op-input"
              value={draft().work_schedule_json}
              onInput={(event) => setDraft({ ...draft(), work_schedule_json: event.currentTarget.value })}
            />
          </label>
          <p class="op-hint">
            Raw JSON, stored as written. <code>{'{"workdays":[1,2,3,4,5]}'}</code> means Monday to
            Friday — 1 is Monday, 7 is Sunday.
          </p>

          <div class="locations-actions">
            <button class="primary" type="submit">
              {draft().id ? "Save location" : "Add location"}
            </button>
            <Show when={draft().id}>
              <GhostPill onClick={() => setDraft(blank())}>Cancel edit</GhostPill>
            </Show>
          </div>
        </form>

        {/* ── the list ────────────────────────────────────────────────────── */}
        <div class="settings-card paper-card">
          <h2 class="paper-section-label">Locations</h2>

          {/* NOTHING EXISTS YET is the only case here — this list has no filter,
              so it can never be "filtered to nothing". The form that creates the
              first one is already on screen, so the action focuses it rather
              than describing where it is. Naming page geography ("create one
              above") is what the old surfaces did and it is what breaks the
              moment the layout changes. */}
          <Show when={!locations.loading && !(locations() ?? []).length}>
            <EmptyState
              title="No locations yet"
              hint="A location is an office, a floor or a room. People and desks are assigned to one."
              actions={
                <button
                  class="primary"
                  type="button"
                  onClick={() => {
                    setDraft(blank());
                    document.querySelector<HTMLInputElement>('.locations-view input[aria-label="Location name"]')?.focus();
                  }}
                >
                  Add the first location
                </button>
              }
            />
          </Show>

          <For each={locations()}>
            {(location) => (
              <button
                class="paper-row"
                type="button"
                onClick={() => setDraft({ ...location, equipment: [...location.equipment] })}
              >
                <span>
                  <span class="paper-row-title">{location.name}</span>
                  <span class="paper-row-meta">
                    <span>{location.location_type}</span>
                    <span>{location.timezone}</span>
                    <span>{location.equipment.join(", ") || "No equipment"}</span>
                  </span>
                </span>
                <Show when={location.channel_id}>
                  <span class="paper-pill teal">Chat linked</span>
                </Show>
              </button>
            )}
          </For>
        </div>

        {/* ── desks ───────────────────────────────────────────────────────── */}
        <div class="settings-card paper-card">
          <h2 class="paper-section-label">Desk assignments</h2>

          <form class="op-form locations-desk-form" onSubmit={saveDesk}>
            {/* Both pickers carry their own value as their label, so the words
                "Member" and "Location" that used to float above them are gone —
                the resting option says it instead. */}
            <PillSelect
              label="Member"
              value={desk().profile_id}
              onChange={(value) => setDesk({ ...desk(), profile_id: value })}
            >
              <option value="">Choose member…</option>
              <For each={profiles()}>
                {(profile) => <option value={profile.id}>{profile.display_name}</option>}
              </For>
            </PillSelect>

            <PillSelect
              label="Location"
              value={desk().location_id}
              onChange={(value) => setDesk({ ...desk(), location_id: value })}
            >
              <option value="">Choose location…</option>
              <For each={locations()}>
                {(location) => <option value={location.id}>{location.name}</option>}
              </For>
            </PillSelect>

            {/* The old markup nested a <label> inside a <label> here, which gives
                the field two names and no reliable one. One control, one name. */}
            <input
              class="op-input"
              aria-label="Seat label"
              placeholder="Desk label"
              value={desk().seat_label ?? ""}
              onInput={(event) => setDesk({ ...desk(), seat_label: event.currentTarget.value || null })}
            />

            {/* These two ARE unguessable — a bare number box called "X" says
                nothing — so they keep captions, share one hint, and are sized to
                what they hold instead of taking a text field's runway. */}
            <label class="op-field">
              <span>Map x</span>
              <input
                class="op-input op-narrow"
                required
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={desk().map_x}
                onInput={(event) => setDesk({ ...desk(), map_x: Number(event.currentTarget.value) })}
              />
            </label>
            <label class="op-field">
              <span>Map y</span>
              <input
                class="op-input op-narrow"
                required
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={desk().map_y}
                onInput={(event) => setDesk({ ...desk(), map_y: Number(event.currentTarget.value) })}
              />
            </label>

            {/* A date input at rest shows a format, not a meaning — "from" and
                "until" cannot be read off the control, so they keep captions. */}
            <label class="op-field">
              <span>From</span>
              <input
                class="op-input op-date"
                required
                type="date"
                value={desk().since_date}
                onInput={(event) => setDesk({ ...desk(), since_date: event.currentTarget.value })}
              />
            </label>
            <label class="op-field">
              <span>Until</span>
              <input
                class="op-input op-date"
                type="date"
                value={desk().till_date ?? ""}
                onInput={(event) => setDesk({ ...desk(), till_date: event.currentTarget.value || null })}
              />
            </label>

            <button class="primary" type="submit" disabled={!deskReady()}>Assign desk</button>
          </form>
          <p class="op-hint">
            Map x and y place the desk on the floor plan as a fraction of its width and
            height: <code>0, 0</code> is the top-left corner, <code>1, 1</code> the bottom-right.
          </p>

          <Show when={!desks.loading && !(desks() ?? []).length}>
            <EmptyState
              title="No desks assigned yet"
              hint="Assigning a desk records where someone sits, and from when."
            />
          </Show>

          <For each={desks()}>
            {(assignment) => (
              <div class="paper-row locations-desk-row">
                <span>
                  <span class="paper-row-title">
                    {personName(assignment.profile_id)} · {locationName(assignment.location_id)}
                  </span>
                  <span class="paper-row-meta">
                    <span>{assignment.seat_label ?? "Map point"}</span>
                    <span>{assignment.map_x}, {assignment.map_y}</span>
                    <span>
                      {assignment.since_date}
                      {assignment.till_date ? ` → ${assignment.till_date}` : ""}
                    </span>
                  </span>
                </span>
                <GhostPill onClick={() => assignment.id && removeDesk(assignment.id)}>Remove</GhostPill>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}
