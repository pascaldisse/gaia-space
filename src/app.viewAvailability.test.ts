/** The web shell hides the views whose commands need a local machine. Getting that
 *  list wrong is invisible in every unit test and total in production: a view that is
 *  filtered out is dropped from `setAvailableViews`, so its route resolves to the
 *  fallback and the rail's button silently lands on /dashboard.
 *
 *  That is exactly what happened to the CRM between 09-17 and 09-19 — shipped, live in
 *  the bundle, and unreachable on paloptic.com/space. This test reads the real source
 *  registry, so the mistake cannot come back quietly. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const listNamed = (name: string) => {
  const line = source.split("\n").find(text => text.startsWith(`const ${name}:View[]=`));
  if (!line) throw new Error(`${name} is no longer declared as a View[] literal — update this test`);
  return Array.from(line.matchAll(/name:"([^"]+)"/g)).map(match => match[1]);
};

describe("web view availability", () => {
  test("only machine-bound views are desktop-only", () => {
    // Repos/Reviews/Pipelines drive a local git working copy and a local runner.
    expect(listNamed("localOnlyViews")).toEqual(["Repos", "Code Reviews", "Pipelines"]);
  });

  test("the CRM is a normal server-backed view — reachable on the web", () => {
    expect(listNamed("localOnlyViews")).not.toContain("CRM");
    expect(listNamed("workspaceViews")).toContain("CRM");
  });

  test("the web filter drops the desktop-only views and nothing else", () => {
    // The filter itself, quoted from App.tsx, so a rewrite of it fails here first.
    expect(source).toContain("if(web()) list=list.filter(v=>!localOnlyViews.includes(v));");
  });
});
