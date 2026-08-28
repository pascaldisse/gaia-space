import { expect, test, describe, afterEach } from "bun:test";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import ConfirmDialog from "./ConfirmDialog";

// DELETING IS THE ONE ACT THAT MUST BE ASKED TWICE. This is that question, and the
// contract is that cancelling is always the easy path: Escape, the backdrop, and the
// button that already holds focus. The destructive button never gets focus by default
// and it names the act ("Delete document"), never "OK".

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
});

const mount = (over: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const calls = { confirmed: 0, cancelled: 0 };
  dispose = render(
    () => (
      <ConfirmDialog
        open={over.open ?? true}
        title={over.title ?? "Delete document?"}
        body={over.body ?? "Gone for everyone."}
        confirmLabel={over.confirmLabel ?? "Delete document"}
        busy={over.busy}
        onConfirm={() => { calls.confirmed += 1; }}
        onCancel={() => { calls.cancelled += 1; }}
      />
    ),
    host,
  );
  return { host, calls };
};

describe("the delete question", () => {
  test("is an alert dialog that names the act, and cancel holds the focus", () => {
    const { host } = mount();

    const dialog = host.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Delete document?");

    const danger = host.querySelector("button.confirm-danger") as HTMLButtonElement;
    // It says what it does. "OK" would be a button that answers a question nobody asked.
    expect(danger.textContent).toBe("Delete document");
    expect(document.activeElement).toBe(host.querySelector("button.confirm-cancel"));
    expect(document.activeElement).not.toBe(danger);
  });

  test("Escape and the backdrop both cancel; only the red button confirms", () => {
    const { host, calls } = mount();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(calls.cancelled).toBe(1);
    expect(calls.confirmed).toBe(0);

    (host.querySelector(".confirm-backdrop") as HTMLElement).click();
    expect(calls.cancelled).toBe(2);

    (host.querySelector("button.confirm-cancel") as HTMLButtonElement).click();
    expect(calls.cancelled).toBe(3);
    expect(calls.confirmed).toBe(0);

    (host.querySelector("button.confirm-danger") as HTMLButtonElement).click();
    expect(calls.confirmed).toBe(1);
  });

  test("closed means absent from the DOM, and a running delete cannot be fired twice", () => {
    const [open, setOpen] = createSignal(false);
    const host = document.createElement("div");
    document.body.appendChild(host);
    let confirmed = 0;
    dispose = render(
      () => (
        <ConfirmDialog
          open={open()}
          title="Delete conversation?"
          body="Gone for everyone."
          confirmLabel="Delete conversation"
          busy={true}
          onConfirm={() => { confirmed += 1; }}
          onCancel={() => {}}
        />
      ),
      host,
    );
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();

    setOpen(true);
    const danger = host.querySelector("button.confirm-danger") as HTMLButtonElement;
    expect(danger.disabled).toBe(true);
    expect(danger.textContent).toBe("Deleting…");
    danger.click();
    expect(confirmed).toBe(0);
  });
});
