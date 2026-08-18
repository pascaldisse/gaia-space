import { invoke } from "@tauri-apps/api/core";

export type Todo = { id:string; profile_id:string; content:string; due_date:string|null; done:boolean; source_entity_type:string|null; source_entity_id:string|null; project_id:string|null; assignee_ids:string[] };
export type Absence = { id:string; profile_id:string; reason_type:string; date_from:string; date_to:string; approved:boolean };
export type Notification = { id:string; recipient_id:string; event_type:string; title:string; body:string|null; entity_type:string|null; entity_id:string|null; created_at:number; read_at:number|null };
export type SubscriptionSetting = { profile_id:string; event_type:string; enabled:boolean };
export type GotoResult = { id:string; entity_type:string; title:string; details:string|null; score:number };
export type MeetingOccurrence = { id:string; meeting_id:string; title:string; starts_at:number; ends_at:number; location:string|null };
export type Dashboard = { open_todos:Todo[]; assigned_issues:{id:string;title:string;project_id:string;number:number;due_date:string|null}[]; meeting_occurrences:MeetingOccurrence[]; unread_notifications:Notification[]; current_absences:Absence[] };
const call = <T>(command:string, args:Record<string,unknown>={}) => invoke<T>(command,args);
export const personalApi = {
  todos:(profile_id:string,include_done=false)=>call<Todo[]>("list_todos",{profileId:profile_id,includeDone:include_done}),
  projectTodos:(project_id:string,include_done=false)=>call<Todo[]>("list_project_todos",{projectId:project_id,includeDone:include_done}),
  createTodo:(input:Omit<Todo,"id">&{id?:string})=>call<Todo>("create_todo",{input}), updateTodo:(todo:Todo)=>call<Todo>("update_todo",{todo}), deleteTodo:(id:string)=>call<void>("delete_todo",{id}),
  absences:(profile_id?:string)=>call<Absence[]>("list_absences",{profileId:profile_id}), createAbsence:(input:Omit<Absence,"id">&{id?:string})=>call<Absence>("create_absence",{input}), updateAbsence:(absence:Absence)=>call<Absence>("update_absence",{absence}), deleteAbsence:(id:string)=>call<void>("delete_absence",{id}), currentAbsences:(date:string)=>call<Absence[]>("current_absences",{date}),
  notifications:(recipient_id:string,unread_only=false)=>call<Notification[]>("list_notifications",{recipientId:recipient_id,unreadOnly:unread_only}), emitNotification:(input:Omit<Notification,"id"|"created_at"|"read_at">&{id?:string})=>call<Notification|null>("emit_notification",{input}), markRead:(id:string)=>call<void>("mark_notification_read",{id}),
  subscriptions:(profile_id:string)=>call<SubscriptionSetting[]>("list_subscription_settings",{profileId:profile_id}), saveSubscription:(setting:SubscriptionSetting)=>call<SubscriptionSetting>("save_subscription_setting",{setting}), deleteSubscription:(profile_id:string,event_type:string)=>call<void>("delete_subscription_setting",{profileId:profile_id,eventType:event_type}),
  gotoSearch:(query:string,limit=30)=>call<GotoResult[]>("goto_search",{query,limit}), dashboard:(profile_id:string)=>call<Dashboard>("dashboard_aggregate",{profileId:profile_id}),
};
