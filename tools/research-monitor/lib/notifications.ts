export type Notification = {
  kind: "success" | "error" | "loading";
  message: string;
  id: string;
};
export type NotificationSink = {
  show: (notice: Notification) => void;
  dismiss: (id?: string) => void;
};

/** Keep notification intent until the on-demand renderer has actually mounted. */
export function createNotifications() {
  let sequence = 0;
  let requested = false;
  let sink: NotificationSink | undefined;
  const pending = new Map<string, Notification>();
  const listeners = new Set<() => void>();
  const show = (kind: Notification["kind"], message: string) => {
    const id = `oevryn-notice-${++sequence}`;
    const notice = { kind, message, id };
    if (sink) sink.show(notice);
    else pending.set(id, notice);
    if (!requested) {
      requested = true;
      for (const listener of listeners) listener();
    }
    return id;
  };
  return {
    toast: {
      success: (message: string) => show("success", message),
      error: (message: string) => show("error", message),
      loading: (message: string) => show("loading", message),
      dismiss(id?: string) {
        if (id === undefined) pending.clear();
        else pending.delete(id);
        sink?.dismiss(id);
      },
    },
    getSnapshot: () => requested,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect(next: NotificationSink) {
      sink = next;
      const queued = [...pending.values()];
      pending.clear();
      for (const notice of queued) next.show(notice);
      return () => {
        if (sink === next) sink = undefined;
      };
    },
  };
}

export const notifications = createNotifications();
export const toast = notifications.toast;
