import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js";
import { platformApi, type DeskAssignment, type Location } from "../api/platform";
import PageHeader, { Chip } from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { Disclosure, SectionHeading } from "../components/blocks";
import { GhostPill, PillSelect, QuietSearch } from "../components/controls";
import { humanError } from "../session";
import "../components/paper.css";
import "./operatorForm.css";
import "./Locations.css";

/**
 * Locations (`/locations`) — offices, floors and who sits where.
 *
 * THE PRODUCT DECISION THIS VIEW IS BUILT ON: these are OPERATOR TOOLS. The
 * person here is an administrator laying out an office, doing the same action
 * many times in a row. So the two creation forms deliberately STAY ON THE
 * SURFACE (law L3 relaxed) — a drawer would cost a click per repetition. What
 * is not relaxed is L4: the forms speak the same control language as every
 * filter row in the app (`operatorForm.css`, `PillSelect`, `blocks.tsx`).
 *
 * ── WHY THERE IS NO WEEKDAY EDITOR, decided by reading the consumer ──────────
 * `work_schedule_json` has exactly ONE consumer in the whole repository:
 *
 *     platform.rs:603  let _: serde_json::Value = serde_json::from_str(..)
 *                          .map_err(|_| "Location work schedule must be JSON")?;
 *
 * It is parsed to prove it is JSON, the result is DISCARDED, and the text is
 * stored verbatim. No Rust and no TypeScript anywhere reads `workdays` — the
 * key appears only in the column DEFAULT (db.rs:1207) and in `blank()` below.
 *
 * So a weekday-row editor would not be "a small contained addition that writes
 * the same JSON". It would be the first code in the product to CLAIM a schema
 * for this column, on a surface with no reader to hold it honest, and every
 * location whose JSON says something else (the column takes any JSON at all)
 * would be silently rewritten into that invented shape the first time an
 * operator opened it and saved. That is a feature with a migration in it, not a
 * legibility sweep. It is NOT started here.
 *
 * What ships instead is the honest version, and it removes the actual trap:
 *   - a real label plus one line saying what the field is and what reads it,
 *   - a PERSISTENT example (a hint under the box, not a placeholder that dies
 *     on the first keystroke),
 *   - validation that names the syntax error, mirroring the Rust rule exactly —
 *     valid JSON, nothing more; `42` and `[]` pass here because they pass there,
 *   - a live "Reads as" line that spells out `workdays` in weekday names when
 *     the value happens to follow the shipped convention. Reading a convention
 *     back to the operator costs no schema; writing one would have invented it.
 *
 * ── AND WHY MAP X/Y ARE BEHIND A DISCLOSURE ─────────────────────────────────
 * Same method, same answer. `map_x`/`map_y` are consumed by a range check
 * (platform.rs:513, 0..=1) and echoed back on the row below. There is no floor
 * plan anywhere in this repository — the previous hint here described placing a
 * desk "on the floor plan", which was a confident sentence about a screen that
 * does not exist. Two required numbers no one can act on are the definition of
 * cryptic, so they move into a disclosure, default to the centre, and say what
 * is actually true: stored for a floor-plan view that has not been built.
 */

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** The value the database column itself defaults to (db.rs:1207). Offered as an
 *  example precisely BECAUSE it is the shipped default — not invented here. */
const SCHEDULE_EXAMPLE = '{"workdays":[1,2,3,4,5]}';

/**
 * The client-side mirror of `platform.rs:603`. It must not be stricter: the Rust
 * side accepts ANY valid JSON document, so a bare number or an empty array is a
 * legal value and this must say so too. All this buys is that the operator is
 * told WHERE the syntax broke before a round trip, instead of receiving
 * "Location work schedule must be JSON" after the save fails.
 */
export const scheduleProblem = (raw: string): string => {
  if (!raw.trim()) {
    return "Work schedule is empty. The column stores JSON text, and an empty box is not valid JSON — use " + SCHEDULE_EXAMPLE + " if there is nothing special to record.";
  }
  try {
    JSON.parse(raw);
    return "";
  } catch (error) {
    return `Not valid JSON yet — ${(error as Error).message}`;
  }
};

/**
 * Reads `workdays` back in words IF the value follows the convention the column
 * default ships. Returns "" for anything else — including valid JSON of another
 * shape — because this line may only ever describe the value, never imply that
 * a different shape is wrong. Nothing in the product reads this key, so a value
 * without it is perfectly legal and gets no warning.
 */
export const scheduleReading = (raw: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const days = (parsed as { workdays?: unknown }).workdays;
  if (!Array.isArray(days)) return "";
  const named = days.filter(
    (day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7,
  );
  if (named.length !== days.length) return "";
  if (!named.length) return "no working days";
  return named.map((day) => WEEKDAY_NAMES[day - 1]).join(", ");
};

const blank = (): Location => ({
  id: "",
  name: "",
  location_type: "Office",
  parent_id: null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  work_schedule_json: SCHEDULE_EXAMPLE,
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

/**
 * One labelled control with its explanation. The hint is a SIBLING of the
 * `<label>`, not a child: nested it would be swallowed into the field's
 * accessible name, so a screen reader would announce the whole sentence every
 * time focus landed. It is wired with `aria-describedby` instead, which is what
 * that relationship is for — hence the render-prop, which hands the caller the
 * id it must put on the actual input.
 */
function Field(props: {
  id: string;
  label: string;
  hint?: JSX.Element;
  grow?: boolean;
  wide?: boolean;
  children: (describedBy: string | undefined) => JSX.Element;
}): JSX.Element {
  const hintId = () => `${props.id}-hint`;
  return (
    <div class="locations-field" classList={{ grow: !!props.grow, wide: !!props.wide }}>
      <label class="op-field">
        <span>{props.label}</span>
        {props.children(props.hint ? hintId() : undefined)}
      </label>
      <Show when={props.hint}>
        <p class="op-hint" id={hintId()}>{props.hint}</p>
      </Show>
    </div>
  );
}

export default function Locations() {
  const [locations, { refetch }] = createResource(() => platformApi.locations());
  const [profiles] = createResource(() => platformApi.profiles());
  const [desks, { refetch: refetchDesks }] = createResource(() => platformApi.deskAssignments());

  const [draft, setDraft] = createSignal<Location>(blank());
  /** The form is not the page. It was permanently open beside an empty state that
   *  asked the reader to add a location — the app telling you to do the thing whose
   *  form was already filling half the screen. It opens when you ask for it, and it
   *  is open whenever you are editing an existing row. */
  const [editorOpen, setEditorOpen] = createSignal(false);
  const openEditor = (value?: Location) => { setDraft(value ?? blank()); setEditorOpen(true); focusName(); };
  const closeEditor = () => { setDraft(blank()); setEditorOpen(false); };
  const [desk, setDesk] = createSignal<DeskAssignment>(blankDesk());
  const [error, setError] = createSignal("");
  const [query, setQuery] = createSignal("");

  /* The list gained a search, which is what makes the SECOND empty-state case
     real: before this, "filters match nothing" could not happen here, so the
     view only ever needed one. Filtering is client-side over the same resource —
     no new call, no change to what the backend returns. */
  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const all = locations() ?? [];
    if (!needle) return all;
    return all.filter((location) =>
      [location.name, location.location_type, location.timezone, ...location.equipment]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  });

  const problem = () => scheduleProblem(draft().work_schedule_json);
  const reading = () => scheduleReading(draft().work_schedule_json);

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    /* Not a new rule: platform.rs rejects the same value. Saying it here means
       the operator reads WHICH character is wrong instead of a generic failure. */
    if (problem()) {
      setError(problem());
      return;
    }
    try {
      setError("");
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

  const focusName = () => {
    document
      .querySelector<HTMLInputElement>('.locations-view input[aria-label="Location name"]')
      ?.focus();
  };

  return (
    <section class="settings-view locations-view">
      <PageHeader
        title="Locations"
        subline="Offices, floors and rooms — and which desk each person sits at."
        chips={
          <>
            <Show when={(locations() ?? []).length}>
              <Chip value={(locations() ?? []).length} label="locations" />
            </Show>
            <Show when={(desks() ?? []).length}>
              <Chip value={(desks() ?? []).length} label="desks assigned" />
            </Show>
          </>
        }
        actions={
          <Show when={!editorOpen() && (locations() ?? []).length > 0}>
            <button type="button" class="primary" onClick={() => openEditor()}>New location</button>
          </Show>
        }
      />

      <Show when={error()}>
        <p class="meeting-error">{error()}</p>
      </Show>

      <div class="settings-grid locations-grid">
        {/* ── the location itself ─────────────────────────────────────────── */}
        <Show when={editorOpen()}>
        <form class="settings-card paper-card" onSubmit={save}>
          <h2 class="paper-section-label">{draft().id ? "Edit location" : "New location"}</h2>

          {/* THIRTEEN EQUAL CAPTIONS WERE THE PROBLEM, not any one of them. The
              sections below are the reader's map: what it is called, where it
              is, when it is open, what is in it, where its chat lives. */}
          <SectionHeading class="locations-section" title="Identity" />
          <div class="op-form locations-row">
            <Field id="loc-name" label="Name" grow>
              {() => (
                <input
                  class="op-input"
                  aria-label="Location name"
                  placeholder="Berlin office"
                  required
                  value={draft().name}
                  onInput={(event) => setDraft({ ...draft(), name: event.currentTarget.value })}
                />
              )}
            </Field>

            {/* `location_type` is free text in the schema (db.rs:1205, default
                'Office') and is only trimmed and stored. The datalist offers the
                usual words WITHOUT taking away the ability to type another —
                turning this into a picker would have removed a capability. */}
            <Field
              id="loc-type"
              label="Type"
              hint="Your own word for it. Shown on the row."
            >
              {(describedBy) => (
                <>
                  <input
                    class="op-input"
                    aria-label="Location type"
                    list="loc-type-options"
                    aria-describedby={describedBy}
                    placeholder="Office"
                    value={draft().location_type}
                    onInput={(event) =>
                      setDraft({ ...draft(), location_type: event.currentTarget.value })
                    }
                  />
                  <datalist id="loc-type-options">
                    <option value="Office" />
                    <option value="Floor" />
                    <option value="Room" />
                    <option value="Warehouse" />
                    <option value="Remote" />
                  </datalist>
                </>
              )}
            </Field>
          </div>

          <SectionHeading class="locations-section" title="Time zone" />
          <div class="op-form locations-row">
            <Field
              id="loc-tz"
              label="Time zone"
              grow
              hint={<>Required. An IANA name such as <code>Europe/Berlin</code>.</>}
            >
              {(describedBy) => (
                <input
                  class="op-input"
                  aria-label="Timezone"
                  aria-describedby={describedBy}
                  placeholder="Europe/Berlin"
                  required
                  value={draft().timezone}
                  onInput={(event) => setDraft({ ...draft(), timezone: event.currentTarget.value })}
                />
              )}
            </Field>
          </div>

          {/* ── the field the whole complaint was about ──────────────────── */}
          <SectionHeading class="locations-section" title="Work schedule" />
          <div class="op-form locations-row">
            <Field
              id="loc-schedule"
              label="Work schedule (JSON)"
              wide
              hint={<>A note for later. Stored as typed; only checked for being valid JSON.</>}
            >
              {(describedBy) => (
                <textarea
                  class="op-input"
                  aria-label="Work schedule JSON"
                  aria-describedby={describedBy}
                  aria-invalid={problem() ? "true" : undefined}
                  rows="3"
                  value={draft().work_schedule_json}
                  onInput={(event) =>
                    setDraft({ ...draft(), work_schedule_json: event.currentTarget.value })
                  }
                />
              )}
            </Field>
          </div>

          {/* A PERSISTENT example. A placeholder would have vanished at the first
              keystroke — exactly when the operator starts needing it. */}
          <p class="op-hint locations-example">
            Example — the value new locations start with:{" "}
            <code>{SCHEDULE_EXAMPLE}</code> (ISO weekday numbers, 1 = Monday … 7 = Sunday).
            <Show when={draft().work_schedule_json.trim() !== SCHEDULE_EXAMPLE}>
              {" "}
              <GhostPill
                onClick={() => openEditor({ ...draft(), work_schedule_json: SCHEDULE_EXAMPLE })}
              >
                Use this example
              </GhostPill>
            </Show>
          </p>

          {/* One of these two shows at a time: the syntax error, or — when the
              value happens to use the shipped convention — that value in words. */}
          <Show when={problem()}>
            <p class="locations-problem" role="alert">{problem()}</p>
          </Show>
          <Show when={!problem() && reading()}>
            <p class="op-hint locations-reading">Reads as working days: {reading()}.</p>
          </Show>

          <SectionHeading class="locations-section" title="Equipment" />
          <div class="op-form locations-row">
            <Field
              id="loc-equipment"
              label="Equipment"
              grow
              hint="Comma-separated. Room booking uses its own list on the meeting room."
            >
              {(describedBy) => (
                <input
                  class="op-input"
                  aria-label="Equipment"
                  aria-describedby={describedBy}
                  placeholder="Projector, Whiteboard"
                  value={draft().equipment.join(", ")}
                  onInput={(event) =>
                    setDraft({
                      ...draft(),
                      equipment: event.currentTarget.value
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              )}
            </Field>
          </div>

          {/* Not a field — an explanation of something that happens without the
              operator asking, which is otherwise only visible as a mystery
              "Chat linked" pill on the row. save_location() creates the channel
              named "<name> chat" (platform.rs:607). */}
          <SectionHeading class="locations-section" title="Chat channel" />
          <p class="op-hint">
            <Show
              when={draft().channel_id}
              fallback={
                <Show
                  when={draft().name.trim()}
                  fallback={<>Saving this location also opens a chat channel named after it. Nothing to fill in here.</>}
                >
                  Saving this location also opens a chat channel for it, named “{draft().name.trim()} chat”. Nothing to fill in here.
                </Show>
              }
            >
              This location has its own chat channel, created when it was first saved.
            </Show>
          </p>

          <div class="locations-actions">
            <button class="primary" type="submit">
              {draft().id ? "Save location" : "Add location"}
            </button>
            <Show when={draft().id}>
              <GhostPill onClick={closeEditor}>Cancel</GhostPill>
            </Show>
          </div>
        </form>
        </Show>

        {/* ── the list ────────────────────────────────────────────────────── */}
        {/* AN EMPTY WORKSPACE SHOWS ONE THING. This page used to draw the list card
            with its own empty state AND the desk card with a second one AND a desk
            form whose "Choose location…" had nothing to choose — three answers to
            "there is nothing here yet", one of them a form for work that cannot be
            done. With no locations, only the lead is drawn. */}
        <Show when={editorOpen() || (locations() ?? []).length > 0} fallback={
          <div class="settings-card paper-card locations-lead-card">
            <EmptyState
              title="No locations yet"
              hint="A location is an office, a floor or a room. People and desks are assigned to one."
              actions={<button class="primary" type="button" onClick={() => openEditor()}>Add the first location</button>}
            />
          </div>
        }>
        <div class="settings-card paper-card">
          <h2 class="paper-section-label">Locations</h2>

          <Show when={(locations() ?? []).length}>
            <div class="op-form locations-filter">
              <QuietSearch
                label="Search locations"
                placeholder="Search name, type, time zone or equipment"
                value={query()}
                onInput={setQuery}
              />
            </div>
          </Show>

          {/* THE TWO CASES, kept apart. Nothing yet → offer the creation that is
              already on screen (focus it; naming page geography breaks the
              moment the layout changes). Search excluded everything → offer to
              clear it, because what they want almost certainly exists. */}
          <Show when={!locations.loading && !(locations() ?? []).length}>
            <EmptyState
              title="No locations yet"
              hint="A location is an office, a floor or a room. People and desks are assigned to one."
              actions={
                <button class="primary" type="button" onClick={() => openEditor()}>
                  Add the first location
                </button>
              }
            />
          </Show>

          <Show when={!locations.loading && (locations() ?? []).length > 0 && !filtered().length}>
            <EmptyState
              variant="no-match"
              title={`No location matches “${query().trim()}”`}
              hint="The search covers name, type, time zone and equipment."
              actions={<GhostPill onClick={() => setQuery("")}>Clear search</GhostPill>}
            />
          </Show>

          <For each={filtered()}>
            {(location) => (
              <button
                class="paper-row"
                type="button"
                onClick={() => openEditor({ ...location, equipment: [...location.equipment] })}
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
                  {/* A FACT, NOT AN ACTION. Teal means "open / needs doing" everywhere else; a
                      channel that exists is neither. */}
                  <span class="paper-pill">Chat linked</span>
                </Show>
              </button>
            )}
          </For>
        </div>

        {/* ── desks ───────────────────────────────────────────────────────── */}
        <Show when={(locations() ?? []).length > 0}>
        <div class="settings-card paper-card">
          <h2 class="paper-section-label">Desk assignments</h2>
          <p class="op-hint locations-lede">
            Records who sits where, and from when. A person can have several over time — this is
            history, not a field on their profile.
          </p>

          <form class="op-form locations-desk-form" onSubmit={saveDesk}>
            {/* Both pickers carry their value as their label, so the captions
                that used to float above them are gone — the resting option says
                it instead. */}
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

            <Field
              id="desk-seat"
              label="Desk label"
              hint="Whatever is written on the desk — “4.12”, “Window south”. Optional."
            >
              {(describedBy) => (
                <input
                  class="op-input"
                  aria-label="Seat label"
                  aria-describedby={describedBy}
                  placeholder="4.12"
                  value={desk().seat_label ?? ""}
                  onInput={(event) =>
                    setDesk({ ...desk(), seat_label: event.currentTarget.value || null })
                  }
                />
              )}
            </Field>

            <Field id="desk-from" label="From">
              {() => (
                <input
                  class="op-input op-date"
                  aria-label="Assigned from"
                  required
                  type="date"
                  value={desk().since_date}
                  onInput={(event) => setDesk({ ...desk(), since_date: event.currentTarget.value })}
                />
              )}
            </Field>

            <Field id="desk-until" label="Until" hint="Leave empty while the desk is still theirs.">
              {(describedBy) => (
                <input
                  class="op-input op-date"
                  aria-label="Assigned until"
                  aria-describedby={describedBy}
                  type="date"
                  value={desk().till_date ?? ""}
                  onInput={(event) =>
                    setDesk({ ...desk(), till_date: event.currentTarget.value || null })
                  }
                />
              )}
            </Field>

            {/* The two coordinates are REQUIRED by the backend and meaningless
                without a floor plan that does not exist, so they keep working
                from their centred default and stop occupying the operator's
                attention. Folded, not removed: the value is still editable. */}
            <Disclosure
              class="locations-map"
              title="Floor-plan position"
              meta={`${desk().map_x} · ${desk().map_y}`}
            >
              <p class="op-hint">
                Where the desk would sit on a floor-plan image, as a fraction of its width and
                height — <code>0, 0</code> top-left, <code>1, 1</code> bottom-right. There is no
                floor-plan view in the app yet, so these are stored for later; the centred
                default is fine.
              </p>
              <div class="op-form">
                <Field id="desk-x" label="Across (0–1)">
                  {() => (
                    <input
                      class="op-input op-narrow"
                      aria-label="Map x"
                      required
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={desk().map_x}
                      onInput={(event) =>
                        setDesk({ ...desk(), map_x: Number(event.currentTarget.value) })
                      }
                    />
                  )}
                </Field>
                <Field id="desk-y" label="Down (0–1)">
                  {() => (
                    <input
                      class="op-input op-narrow"
                      aria-label="Map y"
                      required
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={desk().map_y}
                      onInput={(event) =>
                        setDesk({ ...desk(), map_y: Number(event.currentTarget.value) })
                      }
                    />
                  )}
                </Field>
              </div>
            </Disclosure>

            <button class="primary" type="submit" disabled={!deskReady()}>
              Assign desk
            </button>
          </form>

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
                    <span>{assignment.seat_label ?? "No desk label"}</span>
                    {/* Still shown — the numbers are data an operator entered,
                        and hiding stored values is not the same as explaining
                        them. It is only named now, instead of a bare "0.5, 0.5". */}
                    <span>Map {assignment.map_x}, {assignment.map_y}</span>
                    <span>
                      {assignment.since_date}
                      {assignment.till_date ? ` → ${assignment.till_date}` : " → open ended"}
                    </span>
                  </span>
                </span>
                <GhostPill onClick={() => assignment.id && removeDesk(assignment.id)}>
                  Remove
                </GhostPill>
              </div>
            )}
          </For>
        </div>
        </Show>
        </Show>
      </div>
    </section>
  );
}
