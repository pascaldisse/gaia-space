import { afterEach, describe, expect, test } from "bun:test";
import { render } from "solid-js/web";
import { Avatar } from "./Avatar";

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; });

describe("profile avatars", () => {
  test("renders an uploaded avatar and falls back to initials when it is removed or unavailable", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <><Avatar name="Ada Lovelace" avatarUrl="data:image/png;base64,avatar" /><Avatar name="Grace Hopper" /></>, host);

    const image = host.querySelector<HTMLImageElement>("img.avatar-image");
    expect(image?.src).toContain("data:image/png;base64,avatar");
    expect(host.textContent).toContain("GH");

    image?.dispatchEvent(new Event("error"));
    expect(host.textContent).toContain("AL");
  });
});
