import { invoke } from "@tauri-apps/api/core";

/** Never carries the calendar's URL — the server holds only its sealed form,
 *  and this is the type that ever crosses the wire back to a client. */
export type Calendar = { id:string; profile_id:string; name:string; color:string; visible:boolean };

export type CalendarFeed = {
  id: string;
  profile_id: string;
  label: string;
  created_at: number;
  last_synced_at: number | null;
  last_error: string | null;
  event_count: number;
};

const call = <T>(command: string, args: Record<string, unknown> = {}) => invoke<T>(command, args);

export const calendarFeedsApi = {
  list: (profile_id: string) => call<CalendarFeed[]>("list_calendar_feeds", { profileId: profile_id }),
  // `profile_id` here is shape-only — the server always rebinds it to the
  // session's own profile, the same as every other personal write.
  save: (input: { id?: string; profile_id: string; label: string; ics_url: string }) =>
    call<CalendarFeed>("save_calendar_feed", { input }),
  remove: (id: string) => call<void>("delete_calendar_feed", { id }),
  sync: (id: string) => call<CalendarFeed>("sync_calendar_feed", { id }),
};

export const calendarsApi = {
  list: (profile_id:string) => call<Calendar[]>("list_calendars", { profileId: profile_id }),
  save: (input:{id?:string; profile_id:string; name:string; color:string; visible:boolean}) => call<Calendar>("save_calendar", {input}),
  remove: (id:string) => call<void>("delete_calendar", {id}),
};
