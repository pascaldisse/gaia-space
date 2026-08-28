import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { blogsApi, type BlogPost } from "../api/blogs";
import { documentsApi, newId, type Document } from "../api/documents";
import { platformApi } from "../api/platform";
import { ProfilePicker } from "../components/Pickers";
import PageHeader from "../components/PageHeader";
import { humanError, profileId } from "../session";
import { linkEntity, linkProps, useDeepLink } from "../router";
import "./Blogs.css";
import { UI_LOCALE } from "../calendar";
const date = (seconds:number) => new Date(seconds * 1000).toLocaleDateString(UI_LOCALE,{month:"short",day:"numeric",year:"numeric"});
export default function Blogs() {
  const [term,setTerm]=createSignal(""); const [author,setAuthor]=createSignal(""); const [team,setTeam]=createSignal(""); const [project,setProject]=createSignal(""); const [location,setLocation]=createSignal("");
  const [calendarEventTitle,setCalendarEventTitle]=createSignal(""); const [calendarEventDate,setCalendarEventDate]=createSignal("");
  const [title,setTitle]=createSignal(""); const [body,setBody]=createSignal(""); const [selected,setSelected]=createSignal<string>(); const [error,setError]=createSignal(""); const [publishing,setPublishing]=createSignal(false);
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
      setTitle(""); setBody(""); setCalendarEventTitle(""); setCalendarEventDate(""); await refetch(); setSelected(post.id); linkEntity("blog",post.id);
    } catch(reason) { setError(humanError(reason)); } finally { setPublishing(false); }
  };
  const result=()=>posts()??[];
  return <section class="blogs-view">
    <PageHeader title="Blogs" subline="Organization articles, published from drafts" />
    <Show when={error()}><p class="blogs-error" role="alert">{error()}</p></Show>
    <div class="blogs-layout">
      <aside class="blogs-compose"><h2>Write &amp; publish</h2><ProfilePicker identity/><input value={title()} onInput={e=>setTitle(e.currentTarget.value)} placeholder="Article title" aria-label="Article title"/><textarea value={body()} onInput={e=>setBody(e.currentTarget.value)} placeholder="Write the article…" aria-label="Article body"/>
      <input value={calendarEventTitle()} onInput={e=>setCalendarEventTitle(e.currentTarget.value)} placeholder="Calendar event title (optional)" aria-label="Calendar event title"/>
      <input type="date" value={calendarEventDate()} onInput={e=>setCalendarEventDate(e.currentTarget.value)} aria-label="Calendar event date"/>
        <label>Team<select value={team()} onChange={e=>setTeam(e.currentTarget.value)}><option value="">Organization-wide</option><For each={teams()??[]}>{item=><option value={item.id}>{item.name}</option>}</For></select></label>
        <label>Project<select value={project()} onChange={e=>setProject(e.currentTarget.value)}><option value="">No project target</option><For each={(projects()??[]).filter(p=>!p.archived)}>{item=><option value={item.id}>{item.name}</option>}</For></select></label>
        <label>Location ID<input value={location()} onInput={e=>setLocation(e.currentTarget.value)} placeholder="Optional location"/></label>
        <button class="primary" disabled={publishing()} onClick={publish}>{publishing()?"Publishing…":"Publish article"}</button>
      </aside>
      <section class="blogs-list"><div class="blogs-filter"><input value={term()} onInput={e=>setTerm(e.currentTarget.value)} placeholder="Filter articles"/><select value={author()} onChange={e=>setAuthor(e.currentTarget.value)}><option value="">All authors</option><For each={profiles()??[]}>{item=><option value={item.id}>{item.display_name}</option>}</For></select></div>
        <Show when={posts.loading}><p class="hint">Loading articles…</p></Show><Show when={!posts.loading&&!result().length}><p class="empty-state">No published articles match these filters.</p></Show><For each={result()}>{post=><a classList={{"blog-row":true,active:selectedPost()?.id===post.id}} {...linkProps({view:"Blogs",entityType:"blog",entityId:post.id})} onClick={event=>{linkProps({view:"Blogs",entityType:"blog",entityId:post.id}).onClick(event);setSelected(post.id)}}><strong>{post.title}</strong><span>{date(post.published_at)} · {post.project_id ? "Project article" : post.team_id ? "Team article" : "Organization"}</span></a>}</For>
      </section>
      <article class="blog-detail"><Show when={selectedPost()} fallback={<p class="hint">Select an article to read it.</p>}>{post=><BlogDetail post={post()}/>}</Show></article>
    </div>
  </section>;
}
function BlogDetail(props:{post:BlogPost}) { return <><header><p class="blog-kicker">Organization blog</p><h1>{props.post.title}</h1><p class="blog-meta">Published {date(props.post.published_at)} · author {props.post.author_id}</p></header><div class="blog-body">{props.post.body}</div><Show when={props.post.aliases.length}><footer>Aliases: <For each={props.post.aliases}>{(alias,index)=><><code>/{alias}</code>{index()<props.post.aliases.length-1?", ":""}</>}</For></footer></Show></>; }
