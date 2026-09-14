/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";

render(() => <App online={false} />, document.getElementById("root") as HTMLElement);
