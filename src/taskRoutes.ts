import type { ViewSpec } from "./router";

export const taskRoute = { name: "To-Do", aliases: ["todo", "tasks"] } satisfies ViewSpec;
export const ledgerRoute = { name: "Task Ledger", slug: "task-ledger" } satisfies ViewSpec;
