import { createResource, For, Show } from "solid-js";
import { leadsApi } from "../api/leads";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { humanError } from "../session";
import "./Leads.css";

const displayDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export default function Leads() {
  const [leads, { refetch }] = createResource(leadsApi.list);
  return <section class="leads-view">
    <WorkspaceHeader icon="inbox" title="Leads" actions={<button class="ghost" type="button" onClick={() => void refetch()} disabled={leads.loading}>Refresh</button>}>
      Landing-page contact submissions · administrator-only
    </WorkspaceHeader>
    <Show when={leads.loading}><p class="leads-loading" role="status">Loading leads…</p></Show>
    <Show when={leads.error}><p class="leads-error" role="alert">{humanError(leads.error)}</p></Show>
    <Show when={!leads.loading && !leads.error && leads()?.length === 0}><p class="leads-empty">No contact submissions yet.</p></Show>
    <Show when={!leads.loading && !leads.error && (leads()?.length ?? 0) > 0}>
      <p class="leads-count">{leads()!.length} {leads()!.length === 1 ? "lead" : "leads"}</p>
      <div class="leads-grid">
        <For each={leads()}>{lead => <article class="lead-card">
          <header><div><h2>{lead.name}</h2><p>{lead.business}</p></div><time dateTime={lead.created_at}>{displayDate(lead.created_at)}</time></header>
          <p class="lead-intent"><strong>{lead.bereich}</strong> · {lead.interesse}</p>
          <address>{lead.address}</address>
          <div class="lead-contact"><a href={`tel:${lead.phone}`}>{lead.phone}</a><a href={`mailto:${lead.email}`}>{lead.email}</a></div>
        </article>}</For>
      </div>
    </Show>
  </section>;
}
