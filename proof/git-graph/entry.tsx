/* Proof harness entry: mounts ONLY the Repos view (no shell, no auth) so a headless browser can
 * screenshot the real Graph tab. Backend calls are served by shoot.mjs from the real git.rs. */
import { render } from "solid-js/web";
import Repos from "../../src/views/Repos";
import "../../src/spaceTheme.css";

render(() => <Repos />, document.getElementById("root") as HTMLElement);
