#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const defaults = {
  input: resolve(process.env.HOME ?? "", ".gaia/knowledge/task-ledger/MASTER.md"),
  output: resolve("data/todo.json"),
};

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: bun scripts/ledger-to-todo.mjs [--in <MASTER.md>] [--out <data/todo.json>]");
  process.exit(1);
}

function parseArgs(args) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== "--in" && arg !== "--out") usage(`Unknown option: ${arg}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) usage(`Missing value for ${arg}`);
    if (arg === "--in") options.input = resolve(value);
    else options.output = resolve(value);
  }
  return options;
}

function splitRow(line) {
  const cells = [];
  let cell = "";
  let escaped = false;
  const text = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (const character of text) {
    if (escaped) { cell += character; escaped = false; }
    else if (character === "\\") escaped = true;
    else if (character === "|") { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}

const divider = (cells) => cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
const key = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clean = (value) => value.replace(/\\([|\\])/g, "$1").trim();

function tables(markdown) {
  const result = [];
  let current = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim().startsWith("|")) current.push(splitRow(line));
    else if (current.length) { result.push(current); current = []; }
  }
  if (current.length) result.push(current);
  return result
    .filter(rows => rows.length >= 2 && divider(rows[1]))
    .map(rows => ({ header: rows[0].map(clean), rows: rows.slice(2).filter(row => row.length === rows[0].length).map(row => row.map(clean)) }));
}

function valueOf(row, index, name) {
  const value = row[index.get(name)];
  if (value === undefined) throw new Error(`Missing ${name} cell`);
  return value;
}

function idFor(item) {
  return createHash("sha256").update([item.category, item.date, item.status, item.ask].join("\u0000")).digest("hex").slice(0, 16);
}

function build(markdown) {
  const parsed = tables(markdown);
  const summaryTable = parsed.find(table => table.header.map(key).join("|") === "metric|value");
  if (!summaryTable) throw new Error("MASTER.md has no metric/value summary table");
  const summary = Object.fromEntries(summaryTable.rows.map(([metric, value]) => [key(metric), value]));
  const expectedSummary = ["source task rows", "unique asks", "done omitted", "open", "regressed", "claimed unverified", "superseded"];
  for (const metric of expectedSummary) if (!(metric in summary)) throw new Error(`Summary metric missing: ${metric}`);

  const items = [];
  const required = ["category", "earliest", "status", "repeats", "ask", "next action", "sources"];
  for (const table of parsed) {
    const index = new Map(table.header.map((heading, position) => [key(heading), position]));
    if (!required.every(heading => index.has(heading))) continue;
    for (const row of table.rows) {
      const item = {
        category: valueOf(row, index, "category"),
        date: valueOf(row, index, "earliest"),
        status: valueOf(row, index, "status"),
        repeats: Number(valueOf(row, index, "repeats")),
        ask: valueOf(row, index, "ask"),
        next: valueOf(row, index, "next action"),
        source: valueOf(row, index, "sources"),
      };
      if (!Number.isFinite(item.repeats)) throw new Error(`Invalid repeats for ${item.category}: ${item.repeats}`);
      items.push({ id: idFor(item), ...item });
    }
  }
  if (!items.length) throw new Error("MASTER.md has no task tables");

  const mergeTable = parsed.find(table => key(table.header[0]).startsWith("merge candidates"));
  const mergeCandidates = !mergeTable ? [] : mergeTable.rows.map(row => Object.fromEntries(mergeTable.header.map((heading, position) => [key(heading), row[position]])));
  return { generatedAt: new Date().toISOString(), summary, items, mergeCandidates };
}

const options = parseArgs(process.argv.slice(2));
const source = await readFile(options.input, "utf8");
const output = build(source);
await mkdir(dirname(options.output), { recursive: true });
await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`);
console.log(`ledger-to-todo: ${output.items.length} items, ${output.mergeCandidates.length} merge candidates → ${options.output}`);
