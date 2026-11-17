import { useEffect } from "react";
import { Toaster, toast } from "sonner";
import { notifications } from "@/lib/notifications";

/** Child effects subscribe Sonner before this parent flushes queued messages. */
export default function NotificationHost() {
  useEffect(
    () =>
      notifications.connect({
        show: ({ kind, message, id }) => {
          toast[kind](message, { id });
        },
        dismiss: (id) => {
          toast.dismiss(id);
        },
      }),
    [],
  );
  return <Toaster richColors position="bottom-right" />;
}
