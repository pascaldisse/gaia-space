import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { personalApi, type GotoResult } from "../api/personal";
import { entityView, hrefFor, isViewAvailable } from "../router";
import "./Goto.css";

type Props = { open:boolean; onClose:()=>void; onNavigate:(entityType:string,entityId:string)=>void };
const labels:Record<string,string>={profile:"People",project:"Projects",issue:"Issues",channel:"Channels",document:"Documents",review:"Code reviews",meeting:"Meetings"};
export default function Goto(props:Props) {
  const [query,setQuery]=createSignal(""); let input!:HTMLInputElement;
  const [results]=createResource(query,term=>term.trim()?personalApi.gotoSearch(term):Promise.resolve([]));
  createEffect(()=>{if(props.open)requestAnimationFrame(()=>input?.focus())});
  // Never advertise a target that the current platform cannot open (web excludes Reviews).
  const reachableResults=()=> (results()??[]).filter(result => {
    const view = entityView(result.entity_type);
    return !view || isViewAvailable(view);
  });
  const groups=()=>Object.entries(reachableResults().reduce<Record<string,GotoResult[]>>((all,result)=>{(all[result.entity_type]??=[]).push(result);return all},{}));
  const choose=(result:GotoResult)=>{props.onNavigate(result.entity_type,result.id);props.onClose();setQuery("")};
  return <Show when={props.open}><div class="goto-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)props.onClose()}}><section class="goto-modal" role="dialog" aria-label="Go to anything"><div class="goto-input"><span>⌕</span><input ref={input} value={query()} onInput={event=>setQuery(event.currentTarget.value)} onKeyDown={event=>{if(event.key==="Escape")props.onClose();if(event.key==="Enter"&&reachableResults()[0])choose(reachableResults()[0])}} placeholder="Go to people, projects, issues, channels, documents…"/><kbd>Esc</kbd></div><Show when={results.loading}><p class="goto-muted">Searching…</p></Show><Show when={query()&&!results.loading&&!reachableResults().length}><p class="goto-muted">No matching entities.</p></Show><div class="goto-results"><For each={groups()}>{([kind,items])=><section><h2>{labels[kind]??kind}</h2><For each={items}>{result=><a href={hrefFor({view:entityView(result.entity_type)??"Dashboard",entityType:result.entity_type,entityId:result.id})} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();choose(result)}}><span class="goto-icon">{kind.slice(0,1).toUpperCase()}</span><span><strong>{result.title || result.id}</strong><small>{result.details}</small></span></a>}</For></section>}</For></div><footer><span>↵ Open first result</span><span>Ctrl/Cmd + K closes</span></footer></section></div></Show>;
}
