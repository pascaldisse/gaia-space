import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { blogsApi, type BlogPost } from "../api/blogs";
import { documentsApi, newId, type Document } from "../api/documents";
import { platformApi } from "../api/platform";
import PageHeader from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { GhostPill, PillSelect, QuietSearch } from "../components/controls";
import EmptyState from "../components/EmptyState";
import { humanError, profileId } from "../session";
import { linkEntity, linkProps, useDeepLink } from "../router";
import "../components/WorkItemDrawer.css";
import "./Blogs.css";
import { UI_LOCALE } from "../calendar";
const date = (seconds:number) => new Date(seconds * 1000).toLocaleDateString(UI_LOCALE,{month:"short",day:"numeric",year:"numeric"});
export default function Blogs() {
  const [term,setTerm]=createSignal(""); const [author,setAuthor]=createSignal(""); const [team,setTeam]=createSignal(""); const [project,setProject]=createSignal(""); const [location,setLocation]=createSignal("");
  const [calendarEventTitle,setCalendarEventTitle]=createSignal(""); const [calendarEventDate,setCalendarEventDate]=createSignal("");
  const [title,setTitle]=createSignal(""); const [body,setBody]=createSignal(""); const [selected,setSelected]=createSignal<string>(); const [error,setError]=createSignal(""); const [publishing,setPublishing]=createSignal(false);
  /* L3: the nine publishing fields live in a drawer, never on the reading surface. */
  const [composing,setComposing]=createSignal(false);
  const [posts,{refetch}]=createResource(()=>blogsApi.list({term:term()||undefined,author_id:author()||undefined,team_id:team()||undefined,project_id:project()||undefined,location_id:location()||undefined}));
  const [profiles]=createResource(()=>platformApi.profiles()); const [teams]=createResource(()=>platformApi.teams()); const [projects]=createResource(()=>platformApi.projects());
  const selectedPost=createMemo(()=>posts()?.find(post=>post.id===selected()) ?? posts()?.[0]);
  useDeepLink("blog",setSelected,()=>setSelected());
  const publish=async()=>{
    const owner=profileId(); const headline=title().trim();
    if(!owner || !headline) { setError("Choose a profile and enter a title."); return; }
    setPublishing(true); setError("");
    try {
      const draft:Document={id:newId("blog-draft"),container_type:"my-docs",container_id:owner,folder_id:null,doc_type:"text",body_format:"text",title:headline,body:body(),version:1,archived:false,created_by:owner};
      await documentsApi.createDocument(draft);
      const post=await blogsApi.publish({draft_id:draft.id,author_id:owner,team_id:team()||null,project_id:project()||null,location_id:location()||null,calendar_event_title:calendarEventTitle().trim()||null,calendar_event_date:calendarEventDate()||null});
      setTitle(""); setBody(""); setCalendarEventTitle(""); setCalendarEventDate(""); await refetch(); setSelected(post.id); linkEntity("blog",post.id); setComposing(false);
    } catch(reason) { setError(humanError(reason)); } finally { setPublishing(false); }
  };
  const result=()=>posts()??[];
  /* `team`/`project`/`location` are shared with the COMPOSER's targeting, so they
     are not read as list filters here; only the two list controls are. */
  const blogFiltered=()=>!!term().trim()||!!author();
  const clearBlogFilters=()=>{setTerm("");setAuthor("");};
  return <section class="blogs-view">
    <PageHeader icon="book" title="Blogs" subline="Organization articles, published from drafts"
      actions={<button type="button" class="primary" onClick={()=>setComposing(true)}>Write article</button>} />
    <Show when={error()}><p class="blogs-error" role="alert">{error()}</p></Show>
    <div class="blogs-layout">
      <section class="blogs-list"><div class="blogs-filter">
        <QuietSearch label="Search articles" placeholder="Search articles" value={term()} onInput={setTerm}/>
        <PillSelect label="Author" value={author()} onChange={setAuthor}><option value="">All authors</option><For each={profiles()??[]}>{item=><option value={item.id}>{item.display_name}</option>}</For></PillSelect></div>
        <Show when={posts.loading}><p class="hint">Loading articles…</p></Show>{/* Two cases: a filter hides the articles (clear it), or nothing has been
            published (write one — the primary opens the publishing drawer, which
            is the only place the fields live). */}
        <Show when={!posts.loading&&!result().length&&blogFiltered()}><EmptyState variant="no-match" title="No articles match these filters." actions={<GhostPill onClick={clearBlogFilters}>Clear filters</GhostPill>}/></Show>
        <Show when={!posts.loading&&!result().length&&!blogFiltered()}><EmptyState title="No articles published yet" hint="Announcements and write-ups for the whole organization live here." actions={<button type="button" class="primary" onClick={()=>setComposing(true)}>Write the first article</button>}/></Show><For each={result()}>{post=><a classList={{"blog-row":true,active:selectedPost()?.id===post.id}} {...linkProps({view:"Blogs",entityType:"blog",entityId:post.id})} onClick={event=>{linkProps({view:"Blogs",entityType:"blog",entityId:post.id}).onClick(event);setSelected(post.id)}}><span class="blog-row-icon" aria-hidden="true"><Icon name="book" size={18}/></span><span class="blog-row-copy"><strong>{post.title}</strong><small>{date(post.published_at)} · {post.project_id ? "Project article" : post.team_id ? "Team article" : "Organization"}</small></span><span class="blog-row-open" aria-hidden="true">→</span></a>}</For>
      </section>
      <article class="blog-detail"><Show when={selectedPost()} fallback={<EmptyState title="Nothing selected" hint="Pick an article on the left."/>}>{post=><BlogDetail post={post()}/>}</Show></article>
    </div>
    <Show when={composing()}><BlogComposeDrawer
      title={title()} setTitle={setTitle} body={body()} setBody={setBody}
      calendarEventTitle={calendarEventTitle()} setCalendarEventTitle={setCalendarEventTitle}
      calendarEventDate={calendarEventDate()} setCalendarEventDate={setCalendarEventDate}
      team={team()} setTeam={setTeam} project={project()} setProject={setProject}
      location={location()} setLocation={setLocation}
      teams={teams()??[]} projects={(projects()??[]).filter(p=>!p.archived)}
      busy={publishing()} error={error()} onPublish={publish} onClose={()=>setComposing(false)}/></Show>
  </section>;
}
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Publishing, off the reading surface (L3). Every capability of the old compose
 *  column is here — draft body, the calendar announcement pair, team / project /
 *  location targeting — and captions are allowed because a drawer is a form. */
function BlogComposeDrawer(props:{
  title:string; setTitle:(value:string)=>void; body:string; setBody:(value:string)=>void;
  calendarEventTitle:string; setCalendarEventTitle:(value:string)=>void;
  calendarEventDate:string; setCalendarEventDate:(value:string)=>void;
  team:string; setTeam:(value:string)=>void; project:string; setProject:(value:string)=>void;
  location:string; setLocation:(value:string)=>void;
  teams:{id:string;name:string}[]; projects:{id:string;name:string}[];
  busy:boolean; error:string; onPublish:()=>void; onClose:()=>void;
}) {
  let panel!:HTMLElement; let firstField!:HTMLInputElement;
  const close=()=>{ if(!props.busy) props.onClose(); };
  const onKeyDown=(event:KeyboardEvent)=>{
    if(event.key==="Escape"){ event.preventDefault(); close(); return; }
    if(event.key!=="Tab") return;
    const items=Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(node=>node.offsetParent!==null||node===document.activeElement);
    if(!items.length) return;
    const [first,last]=[items[0],items[items.length-1]];
    const active=document.activeElement as HTMLElement|null;
    if(event.shiftKey&&(active===first||!panel.contains(active))){ event.preventDefault(); last.focus(); }
    else if(!event.shiftKey&&active===last){ event.preventDefault(); first.focus(); }
  };
  onMount(()=>{
    document.addEventListener("keydown",onKeyDown,true);
    firstField?.focus();
    onCleanup(()=>document.removeEventListener("keydown",onKeyDown,true));
  });
  return <div class="wid-root">
    <div class="wid-backdrop" onClick={close} aria-hidden="true"/>
    <aside class="wid-panel" role="dialog" aria-modal="true" aria-labelledby="blog-compose-heading" ref={panel}>
      <header class="wid-head">
        <h2 id="blog-compose-heading">Write &amp; publish</h2>
        <p>The article is published under the profile you are acting as.</p>
      </header>
      <form class="wid-form" onSubmit={event=>{event.preventDefault();props.onPublish();}}>
        <label class="wid-field"><span>Title</span>
          <input class="wid-input" ref={firstField} value={props.title} onInput={event=>props.setTitle(event.currentTarget.value)} placeholder="Article title" aria-label="Article title"/>
        </label>
        <label class="wid-field"><span>Article</span>
          <textarea class="wid-input" value={props.body} onInput={event=>props.setBody(event.currentTarget.value)} placeholder="Write the article…" aria-label="Article body"/>
        </label>
        {/* The calendar announcement path: an article may also become a dated entry. */}
        <label class="wid-field"><span>Calendar announcement (optional)</span>
          <input class="wid-input" value={props.calendarEventTitle} onInput={event=>props.setCalendarEventTitle(event.currentTarget.value)} placeholder="Calendar event title" aria-label="Calendar event title"/>
        </label>
        <label class="wid-field"><span>Announcement date</span>
          <input class="wid-input" type="date" value={props.calendarEventDate} onInput={event=>props.setCalendarEventDate(event.currentTarget.value)} aria-label="Calendar event date"/>
        </label>
        <label class="wid-field"><span>Team</span>
          <select class="wid-input" value={props.team} onChange={event=>props.setTeam(event.currentTarget.value)}>
            <option value="">Organization-wide</option>
            <For each={props.teams}>{item=><option value={item.id}>{item.name}</option>}</For>
          </select>
        </label>
        <label class="wid-field"><span>Project</span>
          <select class="wid-input" value={props.project} onChange={event=>props.setProject(event.currentTarget.value)}>
            <option value="">No project target</option>
            <For each={props.projects}>{item=><option value={item.id}>{item.name}</option>}</For>
          </select>
        </label>
        <label class="wid-field"><span>Location</span>
          <input class="wid-input" value={props.location} onInput={event=>props.setLocation(event.currentTarget.value)} placeholder="Optional location id"/>
        </label>
        <Show when={props.error}><p class="wid-error" role="alert">{props.error}</p></Show>
        <footer class="wid-actions">
          <button type="button" class="wid-btn" onClick={close} disabled={props.busy}>Cancel</button>
          <button type="submit" class="wid-btn wid-primary" disabled={props.busy||!props.title.trim()}>{props.busy?"Publishing…":"Publish article"}</button>
        </footer>
      </form>
    </aside>
  </div>;
}
function BlogDetail(props:{post:BlogPost}) { return <><header><p class="blog-kicker">Organization blog</p><h1>{props.post.title}</h1><p class="blog-meta">Published {date(props.post.published_at)} · author {props.post.author_id}</p></header><div class="blog-body">{props.post.body}</div><Show when={props.post.aliases.length}><footer>Aliases: <For each={props.post.aliases}>{(alias,index)=><><code>/{alias}</code>{index()<props.post.aliases.length-1?", ":""}</>}</For></footer></Show></>; }
