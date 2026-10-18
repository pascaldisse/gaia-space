/* Headless harness: mounts ONLY the real Repos view (same theme CSS as App) so
 * playwright can drive it; invoke() is bridged to the real Rust git-rpc by proof.ts. */
import { render } from "solid-js/web";
import "../../src/App.css";
import "../../src/spaceTheme.css";
import "../../src/palettes/paleblood.tokens.css";
import "../../src/palettes.css";
import Repos from "../../src/views/Repos";
render(() => <Repos />, document.getElementById("root") as HTMLElement);
