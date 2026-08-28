import { createResource, For, Show } from "solid-js";
import { leadsApi } from "../api/leads";
import PageHeader, { Chip } from "../components/PageHeader";
import { GhostPill } from "../components/controls";
import EmptyState from "../components/EmptyState";
import { humanError } from "../session";
import "../components/paper.css";
import "./Leads.css";

/** ── LEADS ──────────────────────────────────────────────────────────────────
 *  Landing-page contact submissions, read-only and ADMINISTRATOR-ONLY (the Rust
 *  side is the gate; this view only reports what it is refused). Behaviour is
 *  unchanged from master: one read, one Refresh, one card per submission.
 *
 *  What changed is the LANGUAGE. It arrived written for the old dark shell —
 *  `WorkspaceHeader` (an icon lozenge plus an explanatory paragraph), which the
 *  redesign removed. It now speaks the current one: `PageHeader` (kicker · h1 ·
 *  ONE subline · chips · actions), paper surfaces, `EmptyState`, `GhostPill`.
 *
 *  COLOUR: none. A lead is neither open work, nor waiting, nor critical — the
 *  three tones (`statusTone.ts`) all mean something this surface does not claim.
 *  The count chip is therefore untoned, which is also what a count of 0 requires.
 *
 *  ONE EMPTY STATE, not two: this view has no filters at all, so an empty list
 *  can only mean "nothing yet" — a `no-match` state here would be a lie, and
 *  offering "clear filters" would point at controls that do not exist. */
const displayDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export default function Leads() {
  const [leads, { refetch }] = createResource(leadsApi.list);
  const count = () => leads()?.length ?? 0;
  const settled = () => !leads.loading && !leads.error;
  return <section class="leads-view">
    {/* NOT the inbox glyph: nav.ts argues at length that Leads is not a second inbox —
        it is the people who came in from the landing page. A mark that repeats a wrong
        claim is worse than no mark. */}
    <PageHeader
      icon="user"
      title="Leads"
      subline="Contact submissions from the landing page — administrators only."
      /* The label carries its own leading space: a chip is `<strong>1</strong>` +
         label, so without it the line reads "1lead" to a screen reader. */
      chips={<Show when={settled() && count() > 0}><Chip value={count()} label={count() === 1 ? " lead" : " leads"} /></Show>}
      actions={<GhostPill onClick={() => void refetch()} disabled={leads.loading}>Refresh</GhostPill>}
    />
    <Show when={leads.loading}><p class="paper-loading" role="status">Loading leads…</p></Show>
    {/* A refusal is NAMED, and it replaces the list — never an empty state, which
        would claim there are no submissions when we simply were not allowed to see them. */}
    <Show when={leads.error}><p class="leads-error" role="alert">{humanError(leads.error)}</p></Show>
    <Show when={settled() && count() === 0}>
      <EmptyState
        title="No contact submissions yet"
        hint="Enquiries sent through the landing page arrive here."
      />
    </Show>
    <Show when={settled() && count() > 0}>
      <div class="leads-grid">
        <For each={leads()}>{lead => <article class="paper-card lead-card">
          <header>
            <div><h2>{lead.name}</h2><p>{lead.business}</p></div>
            <time dateTime={lead.created_at}>{displayDate(lead.created_at)}</time>
          </header>
          <p class="lead-intent"><strong>{lead.bereich}</strong> · {lead.interesse}</p>
          <address>{lead.address}</address>
          <div class="lead-contact"><a href={`tel:${lead.phone}`}>{lead.phone}</a><a href={`mailto:${lead.email}`}>{lead.email}</a></div>
        </article>}</For>
      </div>
    </Show>
  </section>;
}
