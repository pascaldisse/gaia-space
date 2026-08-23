import { invoke } from "@tauri-apps/api/core";

export type TodoContentKind = "text"|"markdown";
export type Todo = { id:string; profile_id:string; content:string; due_date:string|null; project_id:string|null; done:boolean; source_entity_type:string|null; source_entity_id:string|null; notes:string|null; assignee_ids:string[]; content_kind:TodoContentKind };
export type CalendarItem = { id:string; source_id:string; kind:"meeting"|"task"|"deadline"|"blog"|"external"; title:string; starts_at:number; ends_at:number|null; project_id:string|null; calendar_id:string|null; date:string|null };
export type AbsenceAvailability = "away"|"partial"|"available";
// `reason_type` arrives as "Private" when the owner marked it confidential and the
// reader is neither the owner nor an admin; the server redacts, the view never does.
export type Absence = { id:string; profile_id:string; reason_type:string; date_from:string; date_to:string; approved:boolean; reason_confidential:boolean; availability:AbsenceAvailability };
export type Notification = { id:string; recipient_id:string; event_type:string; title:string; body:string|null; entity_type:string|null; entity_id:string|null; created_at:number; read_at:number|null };
export type SubscriptionSetting = { profile_id:string; event_type:string; enabled:boolean };
export type SubscriptionTargetType = "org"|"team"|"project"|"location"|"profile"|"entity";
export type SubscriptionScope = { profile_id:string; event_type:string; target_type:SubscriptionTargetType; target_id:string; enabled:boolean };
export type GotoResult = { id:string; entity_type:string; title:string; details:string|null; score:number };
export type FullTextResult = { id:string; entity_type:string; title:string; snippet:string; breadcrumb:string; score:number };
export type MeetingOccurrence = { id:string; meeting_id:string; title:string; starts_at:number; ends_at:number; location:string|null };
export type Dashboard = { open_todos:Todo[]; assigned_issues:{id:string;title:string;project_id:string;number:number;due_date:string|null}[]; meeting_occurrences:MeetingOccurrence[]; unread_notifications:Notification[]; current_absences:Absence[] };
export type DashboardPreferences = { profile_id:string; hidden_widgets:string[]; initialized:boolean };
export type Follow = { profile_id:string; subject_type:"profile"|"team"; subject_id:string };
export type SubscriptionDeliveryTarget = { profile_id:string; event_type:string; target_kind:"feed"|"channel"|"webhook"; target_id:string; application_id:string|null; enabled:boolean };
export type ProjectDashboard = { project_id:string; open_issues:number; open_todos:number; member_count:number; deadline:string|null };
const call = <T>(command:string, args:Record<string,unknown>={}) => invoke<T>(command,args);
export const personalApi = {
  todos:(profile_id:string,include_done=false)=>call<Todo[]>("list_todos",{profileId:profile_id,includeDone:include_done}),
  projectTodos:(project_id:string,profile_id:string,include_done=false)=>call<Todo[]>("list_project_todos",{projectId:project_id,profileId:profile_id,includeDone:include_done}),
  projectMemberIds:(project_id:string)=>call<string[]>("list_project_member_ids",{projectId:project_id}),
  // `memberId`, not `profileId`: the web transport rewrites any profile id in a
  // request to the caller's own, which would turn "add Charles" into "add me".
  addProjectMember:(project_id:string,member_id:string)=>call<string[]>("add_project_member",{projectId:project_id,memberId:member_id}),
  removeProjectMember:(project_id:string,member_id:string)=>call<string[]>("remove_project_member",{projectId:project_id,memberId:member_id}),
  calendar:(profile_id:string,range_start:number,range_end:number,range_start_date:string,range_end_date:string)=>call<CalendarItem[]>("calendar_aggregate",{profileId:profile_id,rangeStart:range_start,rangeEnd:range_end,rangeStartDate:range_start_date,rangeEndDate:range_end_date}),
  createTodo:(input:Omit<Todo,"id">&{id?:string})=>call<Todo>("create_todo",{input}), updateTodo:(todo:Todo)=>call<Todo>("update_todo",{todo}), setTodoCompletion:(id:string,done:boolean)=>call<Todo>("set_todo_completion",{id,done}), deleteTodo:(id:string)=>call<void>("delete_todo",{id}),
  postponeTodo:(id:string,days:number)=>call<Todo>("postpone_todo",{id,days}),
  convertTodoToIssue:(id:string,project_id:string,status_id?:string)=>call<{id:string;project_id:string;number:number;title:string}>("convert_todo_to_issue",{id,projectId:project_id,statusId:status_id??null}),
  absences:(profile_id?:string)=>call<Absence[]>("list_absences",{profileId:profile_id}), createAbsence:(input:Omit<Absence,"id">&{id?:string})=>call<Absence>("create_absence",{input}), updateAbsence:(absence:Absence)=>call<Absence>("update_absence",{absence}), deleteAbsence:(id:string)=>call<void>("delete_absence",{id}), currentAbsences:(date:string)=>call<Absence[]>("current_absences",{date}),
  notifications:(recipient_id:string,unread_only=false)=>call<Notification[]>("list_notifications",{recipientId:recipient_id,unreadOnly:unread_only}), emitNotification:(input:Omit<Notification,"id"|"created_at"|"read_at">&{id?:string})=>call<Notification|null>("emit_notification",{input}), markRead:(id:string)=>call<void>("mark_notification_read",{id}),
  subscriptions:(profile_id:string)=>call<SubscriptionSetting[]>("list_subscription_settings",{profileId:profile_id}), saveSubscription:(setting:SubscriptionSetting)=>call<SubscriptionSetting>("save_subscription_setting",{setting}), deleteSubscription:(profile_id:string,event_type:string)=>call<void>("delete_subscription_setting",{profileId:profile_id,eventType:event_type}),
  subscriptionScopes:(profile_id:string)=>call<SubscriptionScope[]>("list_subscription_scopes",{profileId:profile_id}), saveSubscriptionScope:(scope:SubscriptionScope)=>call<SubscriptionScope>("save_subscription_scope",{scope}), deleteSubscriptionScope:(scope:Pick<SubscriptionScope,"profile_id"|"event_type"|"target_type"|"target_id">)=>call<void>("delete_subscription_scope",{profileId:scope.profile_id,eventType:scope.event_type,targetType:scope.target_type,targetId:scope.target_id}),
  gotoSearch:(query:string,limit=30)=>call<GotoResult[]>("goto_search",{query,limit}), fullTextSearch:(query:string,limit=30)=>call<FullTextResult[]>("full_text_search",{query,limit}), dashboard:(profile_id:string)=>call<Dashboard>("dashboard_aggregate",{profileId:profile_id}), projectDashboard:(project_id:string)=>call<ProjectDashboard>("project_dashboard_aggregate",{projectId:project_id}), dashboardPreferences:(profile_id:string)=>call<DashboardPreferences>("get_dashboard_preferences",{profileId:profile_id}), saveDashboardPreferences:(preferences:DashboardPreferences)=>call<DashboardPreferences>("set_dashboard_preferences",{preferences}), follows:(profile_id:string)=>call<Follow[]>("list_follows",{profileId:profile_id}), saveFollow:(follow:Follow)=>call<Follow>("save_follow",{follow}), deleteFollow:(follow:Follow)=>call<void>("delete_follow",{follow}), subscriptionDeliveries:(profile_id:string)=>call<SubscriptionDeliveryTarget[]>("list_subscription_deliveries",{profileId:profile_id}), saveSubscriptionDelivery:(delivery:SubscriptionDeliveryTarget)=>call<SubscriptionDeliveryTarget>("save_subscription_delivery",{delivery}), deleteSubscriptionDelivery:(delivery:Pick<SubscriptionDeliveryTarget,"profile_id"|"event_type"|"target_kind"|"target_id">)=>call<void>("delete_subscription_delivery",{profileId:delivery.profile_id,eventType:delivery.event_type,targetKind:delivery.target_kind,targetId:delivery.target_id}),
};
