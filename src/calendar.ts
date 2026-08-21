import type { CalendarItem } from "./api/personal";
export type CalendarEntry = CalendarItem & { day:string; allDay:boolean };
const localDay=(seconds:number)=>{const date=new Date(seconds*1000);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`};
export const calendarEntry=(item:CalendarItem):CalendarEntry=>({...item,day:localDay(item.starts_at),allDay:item.ends_at===null});
export const calendarEntries=(items:CalendarItem[])=>items.map(calendarEntry).sort((a,b)=>a.day.localeCompare(b.day)||Number(b.allDay)-Number(a.allDay)||a.starts_at-b.starts_at||a.title.localeCompare(b.title));
export const monthCells=(cursor:Date)=>{const start=new Date(cursor.getFullYear(),cursor.getMonth(),1);start.setDate(start.getDate()-start.getDay());return Array.from({length:42},(_,i)=>{const day=new Date(start);day.setDate(start.getDate()+i);return day})};
export const entriesForDay=(items:CalendarEntry[],day:Date)=>items.filter(item=>item.day===localDay(day.getTime()/1000));
export const kindPresence=(items:CalendarEntry[])=>((["meeting","task","deadline"] as const).filter(kind=>items.some(item=>item.kind===kind)));
