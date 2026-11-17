import test from "node:test";
import assert from "node:assert/strict";
import { createNotifications, type Notification, type NotificationSink } from "../lib/notifications";

function collector() {
  const shown: Notification[] = [],
    dismissed: (string | undefined)[] = [];
  const sink: NotificationSink = {
    show: (notice) => shown.push(notice),
    dismiss: (id) => dismissed.push(id),
  };
  return { shown, dismissed, sink };
}

test("the renderer is requested only by the first notice and messages wait for its subscription", () => {
  const bus = createNotifications(),
    receiver = collector();
  let activations = 0;
  const stop = bus.subscribe(() => activations++);
  assert.equal(bus.getSnapshot(), false);
  const id = bus.toast.success("Saved"),
    error = bus.toast.error("Unavailable");
  assert.equal(bus.getSnapshot(), true);
  assert.equal(activations, 1);
  bus.connect(receiver.sink);
  assert.deepEqual(receiver.shown, [
    { kind: "success", message: "Saved", id },
    { kind: "error", message: "Unavailable", id: error },
  ]);
  const next = bus.toast.loading("Loading");
  assert.equal(receiver.shown.at(-1)?.id, next);
  bus.toast.dismiss(next);
  assert.deepEqual(receiver.dismissed, [next]);
  stop();
});

test("work finishing before the lazy host arrives cannot leave a stale loading notice", () => {
  const bus = createNotifications(),
    receiver = collector();
  const loading = bus.toast.loading("Loading");
  bus.toast.dismiss(loading);
  const result = bus.toast.success("Done");
  bus.connect(receiver.sink);
  assert.deepEqual(receiver.shown, [{ kind: "success", message: "Done", id: result }]);
  assert.deepEqual(receiver.dismissed, []);
});

test("disconnects queue subsequent messages without replaying already delivered ones", () => {
  const bus = createNotifications(),
    first = collector(),
    second = collector();
  const disconnect = bus.connect(first.sink);
  bus.toast.success("First");
  disconnect();
  const id = bus.toast.error("Next");
  bus.connect(second.sink);
  disconnect(); // A stale cleanup must not disconnect a newer host.
  bus.toast.success("Last");
  assert.deepEqual(
    second.shown.map((notice) => notice.message),
    ["Next", "Last"],
  );
  assert.equal(second.shown[0].id, id);
  assert.equal(first.shown.length, 1);
});

test("dismiss all clears queued messages and preserves mounted-host dismissal semantics", () => {
  const bus = createNotifications(),
    receiver = collector();
  bus.toast.loading("Loading");
  bus.toast.error("Error");
  bus.toast.dismiss();
  bus.connect(receiver.sink);
  assert.deepEqual(receiver.shown, []);
  bus.toast.dismiss();
  assert.deepEqual(receiver.dismissed, [undefined]);
});
