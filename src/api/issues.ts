import { invoke } from "@tauri-apps/api/core";

// `assignee_ids` is the truth (an issue is worked by people); `assignee_id` is the
// first of them and stays for legacy filters.
export type Issue = { id:string; project_id:string; number:number; title:string; description:string|null; status_id:string|null; assignee_id:string|null; created_by:string|null; due_date:string|null; priority:string|null; archived:boolean; assignee_ids:string[] };
export type Status = { id:string; project_id:string; name:string; resolved:boolean; color:string; ordering:number };
export type Board = { id:string; project_id:string; name:string; backlog_type:string; archived:boolean };
export type BoardColumn = { id:string; board_id:string; name:string; ordering:number; status_ids:string[] };
export type BoardCardSettings = { board_id:string; fields:string[] };
export type Swimlane = { id:string; board_id:string; sprint_id:string|null; name:string; is_default:boolean; ordering:number };
export type Sprint = { id:string; board_id:string; name:string; state:"PLANNED"|"CURRENT"|"CLOSED"; starts_on:string|null; ends_on:string|null; description:string|null; archived:boolean };
export type PlanningTag = { id:string; project_id:string; parent_id:string|null; name:string; archived:boolean };
export type Checklist = { id:string; issue_id:string; title:string; ordering:number };
export type ChecklistItem = { id:string; checklist_id:string; parent_id:string|null; item_text:string; item_done:boolean; ordering:number };
export type TimeEntry = { id:string; issue_id:string; profile_id:string; entry_date:string; duration_minutes:number; description:string|null };
export type IssueDetail = { issue:Issue; tags:PlanningTag[]; checklists:Checklist[]; time_total_minutes:number; children:Issue[] };
const call = <T>(command:string, args:Record<string, unknown> = {}) => invoke<T>(command, args);
export const planningApi = {
  issues: (filters: Partial<{project_id:string;text:string;status_id:string;assignee_id:string;tag_id:string;include_archived:boolean}> = {}) => call<Issue[]>("list_issues", filters),
  // The server flattens the issue into the detail object (`#[serde(flatten)]`),
  // so accept BOTH shapes and always hand back `{ issue, … }`.
  issue: async (id:string): Promise<IssueDetail|null> => {
    const raw = await call<Record<string, unknown>|null>("get_issue_detail", { id });
    if (!raw) return null;
    const issue = (raw.issue ?? raw) as Issue;
    return { issue, tags: (raw.tags as PlanningTag[]) ?? [], checklists: (raw.checklists as Checklist[]) ?? [], time_total_minutes: (raw.time_total_minutes as number) ?? 0, children: (raw.children as Issue[]) ?? [] };
  },
  createIssue: (input: Omit<Issue,"id"|"number"|"assignee_ids"> & { id?:string; assignee_ids?:string[] }) => call<Issue>("create_issue", { input }),
  assignees: (issue_id:string) => call<string[]>("list_issue_assignees", { issueId: issue_id }),
  setAssignees: (issue_id:string, profile_ids:string[]) => call<string[]>("set_issue_assignees", { issueId: issue_id, profileIds: profile_ids }),
  updateIssue: (issue:Issue) => call<Issue>("update_issue", { issue }), archiveIssue: (id:string, archived:boolean) => call<void>("archive_issue", {id, archived}),
  statuses: (project_id?:string) => call<Status[]>("list_issue_statuses", {projectId:project_id}),
  createStatus: (input: Omit<Status,"id"|"ordering"> & {id?:string;ordering?:number}) => call<Status>("create_issue_status", {input}),
  updateStatus: (status:Status) => call<void>("update_issue_status", {status}), deleteStatus:(id:string)=>call<void>("delete_issue_status",{id}),
  boards:(project_id?:string)=>call<Board[]>("list_boards",{projectId:project_id}), createBoard:(input:Omit<Board,"id">&{id?:string})=>call<Board>("create_board",{input}), updateBoard:(board:Board)=>call<void>("update_board",{board}), deleteBoard:(id:string)=>call<void>("delete_board",{id}),
  columns:(board_id:string)=>call<BoardColumn[]>("list_board_columns",{boardId:board_id}), saveColumn:(input:Omit<BoardColumn,"id"|"ordering">&{id?:string;ordering?:number})=>call<BoardColumn>("save_board_column",{input}), deleteColumn:(id:string)=>call<void>("delete_board_column",{id}), cardSettings:(board_id:string)=>call<BoardCardSettings>("get_board_card_settings",{boardId:board_id}), saveCardSettings:(settings:BoardCardSettings)=>call<BoardCardSettings>("save_board_card_settings",{settings}),
  boardIssues:(board_id:string,sprint_id?:string)=>call<Issue[]>("list_board_issues",{boardId:board_id,sprintId:sprint_id}), backlog:(board_id:string)=>call<Issue[]>("list_backlog_issues",{boardId:board_id}), move:(board_id:string,issue_id:string,column_id:string,sprint_id?:string,position?:number,swimlane_id?:string)=>call<void>("move_issue_on_board",{boardId:board_id,issueId:issue_id,columnId:column_id,sprintId:sprint_id,swimlaneId:swimlane_id ?? null,position}), remove:(board_id:string,issue_id:string)=>call<void>("remove_issue_from_board",{boardId:board_id,issueId:issue_id}),
  sprints:(board_id?:string)=>call<Sprint[]>("list_sprints",{boardId:board_id}), createSprint:(input:Omit<Sprint,"id"|"state"|"archived">&{id?:string})=>call<Sprint>("create_sprint",{input}), launchSprint:(id:string)=>call<void>("launch_sprint",{id}), closeSprint:(id:string)=>call<void>("close_sprint",{id}), deleteSprint:(id:string)=>call<void>("delete_sprint",{id}), swimlanes:(board_id:string,sprint_id?:string)=>call<Swimlane[]>("list_swimlanes",{boardId:board_id,sprintId:sprint_id}), saveSwimlane:(input:Omit<Swimlane,"id"|"ordering">&{id?:string;ordering?:number})=>call<Swimlane>("save_swimlane",{input}), deleteSwimlane:(id:string)=>call<void>("delete_swimlane",{id}),
  tags:(project_id:string)=>call<PlanningTag[]>("list_planning_tags",{projectId:project_id}), saveTag:(input:Omit<PlanningTag,"id">&{id?:string})=>call<PlanningTag>("save_planning_tag",{input}), setTags:(issue_id:string,tag_ids:string[])=>call<void>("set_issue_tags",{issueId:issue_id,tagIds:tag_ids}),
  checklists:(issue_id:string)=>call<Checklist[]>("list_checklists",{issueId:issue_id}), saveChecklist:(input:Omit<Checklist,"id"|"ordering">&{id?:string;ordering?:number})=>call<Checklist>("save_checklist",{input}), items:(checklist_id:string)=>call<ChecklistItem[]>("list_checklist_items",{checklistId:checklist_id}), saveItem:(input:Omit<ChecklistItem,"id"|"ordering">&{id?:string;ordering?:number})=>call<ChecklistItem>("save_checklist_item",{input}), toggleItem:(id:string,item_done:boolean)=>call<void>("toggle_checklist_item",{id,itemDone:item_done}),
  time:(issue_id:string)=>call<TimeEntry[]>("list_time_tracking_entries",{issueId:issue_id}), saveTime:(input:Omit<TimeEntry,"id">&{id?:string})=>call<TimeEntry>("save_time_tracking_entry",{input}), total:(issue_id:string)=>call<number>("issue_time_total",{issueId:issue_id}), addChild:(parent_id:string,child_id:string)=>call<void>("add_issue_child",{parentId:parent_id,childId:child_id}),
};
