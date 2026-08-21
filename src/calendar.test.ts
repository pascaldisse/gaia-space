import { expect,test } from "bun:test"; import { calendarEntries, kindPresence, monthCells } from "./calendar";
const at=(day:number,hour=0)=>new Date(2026,2,day,hour).getTime()/1000;
test("normalizes local days and marks null ends all-day",()=>{const item=calendarEntries([{id:"a",kind:"task",title:"A",starts_at:at(3),ends_at:null,project_id:null}])[0];expect(item.day).toBe("2026-03-03");expect(item.allDay).toBe(true)});
test("orders all-day before timed entries",()=>expect(calendarEntries([{id:"b",kind:"meeting",title:"B",starts_at:at(3,9),ends_at:at(3,10),project_id:null},{id:"a",kind:"task",title:"A",starts_at:at(3),ends_at:null,project_id:null}]).map(x=>x.id)).toEqual(["a","b"]));
test("kind presence follows display order",()=>expect(kindPresence(calendarEntries([{id:"x",kind:"deadline",title:"X",starts_at:at(1),ends_at:null,project_id:null},{id:"y",kind:"meeting",title:"Y",starts_at:at(1),ends_at:null,project_id:null}]))).toEqual(["meeting","deadline"]));
test("month always has Sunday-first 42 cells",()=>{const cells=monthCells(new Date(2026,2,15));expect(cells).toHaveLength(42);expect(cells[0].getDay()).toBe(0)});
