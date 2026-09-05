import { invoke } from "@tauri-apps/api/core";

export type TodoContentKind = "text"|"markdown";
/** The ONE list of task categories on the client. A category says what KIND of work a
 *  task is; it is a CLOSED short list, not free text, because a free field produces five
 *  spellings of the same word and then nothing can be grouped. Mirror of
 *  `personal::TODO_CATEGORIES` in src-tauri — the server refuses anything else. */
export const TODO_CATEGORIES = [{id:"create",label:"Create"},{id:"improve",label:"Improve"},{id:"review",label:"Review"},{id:"decide",label:"Decide"},{id:"admin",label:"Admin"}] as const;
export type TodoCategory = typeof TODO_CATEGORIES[number]["id"];
/** `category` is OPTIONAL: absent or null means uncategorised, which is the normal case. */
// `links` is optional on the CLIENT TYPE only (not on the wire, where the server always
// sends the array): dozens of existing test fixtures build a `Todo` literal without it,
// and a required field there would be a mechanical, feature-unrelated edit to every one
// of them. Every reader treats an absent value as `[]` (see `TaskMeta.tsx`).
export type Todo = { id:string; profile_id:string; content:string; due_date:string|null; project_id:string|null; done:boolean; source_entity_type:string|null; source_entity_id:string|null; notes:string|null; assignee_ids:string[]; content_kind:TodoContentKind; category?:string|null; links?:TodoLink[] };
/** A task's external/cross-task links. `EXTERNAL` = a bare URL (GitHub issue/PR, doc, …),
 *  `TASK` = another task by id (`target_id`); `url` and `target_id` are mutually exclusive
 *  by kind. The server owns ids; `add_todo_link` returns the created row. */
export type TodoLink = { id:string; todo_id:string; kind:"EXTERNAL"|"TASK"; url:string|null; target_id:string|null; title:string|null };
/** What `create_todo`/`update_todo` accept: a full `Todo` minus the server-assigned id
 *  (present on update, absent on create). Sending `links` REPLACES the todo's link set. */
export type TodoInput = Omit<Todo,"id"> & { id?:string };
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
export type Dashboard = { open_todos:Todo[]; meeting_occurrences:MeetingOccurrence[]; unread_notifications:Notification[]; current_absences:Absence[] };
export type DashboardPreferences = { profile_id:string; hidden_widgets:string[]; initialized:boolean };
export type Follow = { profile_id:string; subject_type:"profile"|"team"; subject_id:string };
export type SubscriptionDeliveryTarget = { profile_id:string; event_type:string; target_kind:"feed"|"channel"|"webhook"; target_id:string; application_id:string|null; enabled:boolean };
export type ProjectDashboard = { project_id:string; open_issues:number; open_todos:number; member_count:number; deadline:string|null };
export type CalendarOptions = { profile_id:string; show_weekends:boolean; show_todos:boolean; working_hours_only:boolean; working_hours_start:number; working_hours_end:number; show_declined:boolean };
const call = <T>(command:string, args:Record<string,unknown>={}) => invoke<T>(command,args);
export const personalApi = {
  todos:(profile_id:string,include_done=false)=>call<Todo[]>("list_todos",{profileId:profile_id,includeDone:include_done}),
  // Shared surface: returns EVERY member's project todos, not only the caller's. A
  // project lead is informational and gets no wider read than any other member.
  projectTodos:(project_id:string,profile_id:string,include_done=false)=>call<Todo[]>("list_project_todos",{projectId:project_id,profileId:profile_id,includeDone:include_done}),
  // Cross-project team surface: other people's running project work, everywhere the
  // caller is a member/owner. Project-less personal todos are excluded.
  teamTodos:(profile_id:string,include_done=false)=>call<Todo[]>("list_team_todos",{profileId:profile_id,includeDone:include_done}),
  projectMemberIds:(project_id:string)=>call<string[]>("list_project_member_ids",{projectId:project_id}),
  // `memberId`, not `profileId`: the web transport rewrites any profile id in a
  // request to the caller's own, which would turn "add Charles" into "add me".
  addProjectMember:(project_id:string,member_id:string)=>call<string[]>("add_project_member",{projectId:project_id,memberId:member_id}),
  removeProjectMember:(project_id:string,member_id:string)=>call<string[]>("remove_project_member",{projectId:project_id,memberId:member_id}),
  calendar:(profile_id:string,range_start:number,range_end:number,range_start_date:string,range_end_date:string,target_profile_id?:string,target_location?:string)=>call<CalendarItem[]>("calendar_aggregate",{profileId:profile_id,rangeStart:range_start,rangeEnd:range_end,rangeStartDate:range_start_date,rangeEndDate:range_end_date,targetProfileId:target_profile_id??null,targetLocation:target_location??null}),
  createTodo:(input:Omit<Todo,"id">&{id?:string})=>call<Todo>("create_todo",{input}), updateTodo:(todo:Todo)=>call<Todo>("update_todo",{todo}), setTodoCompletion:(id:string,done:boolean)=>call<Todo>("set_todo_completion",{id,done}),
  /** Deleting a task is OWNER-ONLY, and the owner is decided by the SERVER: `actorId`
   *  is the identity that gate runs against (desktop has no session to mint it from).
   *  A refusal comes back as a rejection and must reach the screen — never swallowed. */
  deleteTodo:(id:string,actor_id:string)=>call<void>("delete_todo",{id,actorId:actor_id}),
  postponeTodo:(id:string,days:number)=>call<Todo>("postpone_todo",{id,days}),
  todoLinks:(todo_id:string)=>call<TodoLink[]>("list_todo_links",{todoId:todo_id}),
  addTodoLink:(input:{todo_id:string;kind:TodoLink["kind"];url?:string|null;target_id?:string|null;title?:string|null})=>call<TodoLink>("add_todo_link",{todoId:input.todo_id,kind:input.kind,url:input.url??null,targetId:input.target_id??null,title:input.title??null}),
  deleteTodoLink:(id:string)=>call<void>("delete_todo_link",{id}),
  absences:(profile_id?:string)=>call<Absence[]>("list_absences",{profileId:profile_id}), createAbsence:(input:Omit<Absence,"id">&{id?:string})=>call<Absence>("create_absence",{input}), updateAbsence:(absence:Absence)=>call<Absence>("update_absence",{absence}), deleteAbsence:(id:string)=>call<void>("delete_absence",{id}), currentAbsences:(date:string)=>call<Absence[]>("current_absences",{date}),
  notifications:(recipient_id:string,unread_only=false)=>call<Notification[]>("list_notifications",{recipientId:recipient_id,unreadOnly:unread_only}), emitNotification:(input:Omit<Notification,"id"|"created_at"|"read_at">&{id?:string})=>call<Notification|null>("emit_notification",{input}), markRead:(id:string)=>call<void>("mark_notification_read",{id}),
  subscriptions:(profile_id:string)=>call<SubscriptionSetting[]>("list_subscription_settings",{profileId:profile_id}), saveSubscription:(setting:SubscriptionSetting)=>call<SubscriptionSetting>("save_subscription_setting",{setting}), deleteSubscription:(profile_id:string,event_type:string)=>call<void>("delete_subscription_setting",{profileId:profile_id,eventType:event_type}),
  subscriptionScopes:(profile_id:string)=>call<SubscriptionScope[]>("list_subscription_scopes",{profileId:profile_id}), saveSubscriptionScope:(scope:SubscriptionScope)=>call<SubscriptionScope>("save_subscription_scope",{scope}), deleteSubscriptionScope:(scope:Pick<SubscriptionScope,"profile_id"|"event_type"|"target_type"|"target_id">)=>call<void>("delete_subscription_scope",{profileId:scope.profile_id,eventType:scope.event_type,targetType:scope.target_type,targetId:scope.target_id}),
  gotoSearch:(query:string,limit=30)=>call<GotoResult[]>("goto_search",{query,limit}), fullTextSearch:(query:string,limit=30)=>call<FullTextResult[]>("full_text_search",{query,limit}), dashboard:(profile_id:string)=>call<Dashboard>("dashboard_aggregate",{profileId:profile_id}), projectDashboard:(project_id:string)=>call<ProjectDashboard>("project_dashboard_aggregate",{projectId:project_id}), calendarOptions:(profile_id:string)=>call<CalendarOptions>("get_calendar_options",{profileId:profile_id}), saveCalendarOptions:(options:CalendarOptions)=>call<CalendarOptions>("set_calendar_options",{options}), dashboardPreferences:(profile_id:string)=>call<DashboardPreferences>("get_dashboard_preferences",{profileId:profile_id}), saveDashboardPreferences:(preferences:DashboardPreferences)=>call<DashboardPreferences>("set_dashboard_preferences",{preferences}), follows:(profile_id:string)=>call<Follow[]>("list_follows",{profileId:profile_id}), saveFollow:(follow:Follow)=>call<Follow>("save_follow",{follow}), deleteFollow:(follow:Follow)=>call<void>("delete_follow",{follow}), subscriptionDeliveries:(profile_id:string)=>call<SubscriptionDeliveryTarget[]>("list_subscription_deliveries",{profileId:profile_id}), saveSubscriptionDelivery:(delivery:SubscriptionDeliveryTarget)=>call<SubscriptionDeliveryTarget>("save_subscription_delivery",{delivery}), deleteSubscriptionDelivery:(delivery:Pick<SubscriptionDeliveryTarget,"profile_id"|"event_type"|"target_kind"|"target_id">)=>call<void>("delete_subscription_delivery",{profileId:delivery.profile_id,eventType:delivery.event_type,targetKind:delivery.target_kind,targetId:delivery.target_id}),
};
