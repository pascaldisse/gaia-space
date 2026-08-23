import { invoke } from "@tauri-apps/api/core";
export type BlogPost = { id:string; draft_id:string|null; title:string; body:string; author_id:string; aliases:string[]; team_id:string|null; project_id:string|null; location_id:string|null; created_at:number; published_at:number; archived:boolean; archived_by:string|null; archived_at:number|null };
export type BlogFilter = { term?:string; author_id?:string; team_id?:string; project_id?:string; location_id?:string; include_archived?:boolean };
type PublishBlogDraftInput = { draft_id:string; author_id:string; team_id:string|null; project_id:string|null; location_id:string|null; calendar_event_title?:string|null; calendar_event_date?:string|null };
const call=<T>(command:string,args:Record<string,unknown>={})=>invoke<T>(command,args);
export const blogsApi={
  list:(filter:BlogFilter={})=>call<BlogPost[]>("list_blog_posts",{filter}),
  get:(id:string)=>call<BlogPost|null>("get_blog_post",{id}),
  publish:(input:PublishBlogDraftInput)=>call<BlogPost>("publish_blog_draft",{input}),
  archive:(id:string,archived:boolean,actor_id:string|null)=>call<BlogPost>("archive_blog_post",{id,archived,actorId:actor_id}),
};
