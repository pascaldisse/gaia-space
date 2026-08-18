import { expect, test, describe, afterEach } from "bun:test";
import { render } from "solid-js/web";
import { Icon, type IconName } from "./components/Icon";

// Real rendered-DOM regression for the SVG icon system (run under the
// test/solid-dom-preload.ts environment: happy-dom + solid client build).
//
// The prior bug: glyphs were stored as pre-evaluated JSX nodes (single live DOM
// elements), so when the same icon appeared in two live destinations at once,
// the node moved to the last mount and the earlier one — e.g. the Organization
// primary-nav button — rendered an EMPTY <svg>. These assertions inspect the
// actual rendered DOM, not the config.

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; });

function mount(node: () => unknown) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(node as () => any, host);
  return host;
}

describe("Icon rendered DOM", () => {
  test("the same glyph renders visibly in two simultaneous mounts", () => {
    // The exact real-world collision: `org` in the Organization nav button AND
    // in the Knowledge header at the same time.
    const host = mount(() => (
      <>
        <span class="a"><Icon name="org" size={17} /></span>
        <span class="b"><Icon name="org" size={22} /></span>
      </>
    ));
    const a = host.querySelector(".a svg");
    const b = host.querySelector(".b svg");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // both must carry actual path geometry — neither may be an empty shell
    expect(a!.querySelector("path")).not.toBeNull();
    expect(b!.querySelector("path")).not.toBeNull();
  });

  test("every top-nav destination icon produces a non-empty svg", () => {
    // the full set of primary + secondary + project-context nav glyphs
    const names: IconName[] = [
      "home", "check", "clock-nav", "inbox", "layers", "calendar-nav",
      "book-nav", "org", "settings", "users", "target", "columns", "book",
      "chat", "calendar", "repo", "review", "pipeline", "package", "clock",
    ];
    for (const name of names) {
      const host = mount(() => <Icon name={name} />);
      const svg = host.querySelector("svg");
      expect(svg, `svg missing for ${name}`).not.toBeNull();
      // a visible glyph has at least one geometry child (path/circle)
      expect(svg!.querySelector("path, circle"), `empty glyph for ${name}`).not.toBeNull();
      dispose?.(); dispose = undefined; host.remove();
    }
  });
});
