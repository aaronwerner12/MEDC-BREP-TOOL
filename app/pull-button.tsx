"use client";

import { useFormStatus } from "react-dom";

// Submit button that shows a pending state while the feed pull runs. Must live
// inside the <form> whose action is pullFeeds.
export function PullButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? "Pulling feeds…" : "Pull feeds now"}
    </button>
  );
}
