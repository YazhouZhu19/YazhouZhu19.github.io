import { Component, lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { notifications, type Notification } from "@/lib/notifications";
import "@/styles/notification-fallback.css";

const NotificationHost = lazy(() => import("./notification-host"));

/** A failed optional renderer must not replace an otherwise usable workspace. */
function NotificationFallback() {
  const [notices, setNotices] = useState<Notification[]>([]);
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const remove = (id?: string) => {
      setNotices((current) => (id === undefined ? [] : current.filter((notice) => notice.id !== id)));
      for (const [key, timer] of timers)
        if (id === undefined || key === id) {
          clearTimeout(timer);
          timers.delete(key);
        }
    };
    const disconnect = notifications.connect({
      show: (notice) => {
        setNotices((current) => [...current, notice]);
        if (notice.kind !== "loading")
          timers.set(
            notice.id,
            setTimeout(() => remove(notice.id), 4000),
          );
      },
      dismiss: remove,
    });
    return () => {
      disconnect();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);
  return (
    <div className="notification-fallback" aria-live="polite">
      {notices.slice(-3).map((notice) => (
        <div key={notice.id} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.message}
        </div>
      ))}
    </div>
  );
}
class NotificationRecovery extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <NotificationFallback /> : this.props.children;
  }
}
export function NotificationBoundary() {
  const requested = useSyncExternalStore(notifications.subscribe, notifications.getSnapshot, () => false);
  return requested ? (
    <NotificationRecovery>
      <Suspense fallback={null}>
        <NotificationHost />
      </Suspense>
    </NotificationRecovery>
  ) : null;
}
