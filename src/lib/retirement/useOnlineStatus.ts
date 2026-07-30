'use client';

import { useEffect, useState } from 'react';

/**
 * `navigator.onLine` plus the `online`/`offline` events — a narrow, imperfect proxy
 * (reports local network-interface state, not "can actually reach this app's backend"),
 * the same documented limitation Phase 1's own "no connectivity badge" call already
 * accepts for the same reason (see `AppShell.tsx`). Scoped to gating exactly one thing —
 * the Results/Editor "Run simulation" action, per `docs/DESIGN_SPEC.md`'s "Reconnect to
 * run this" state — not a general connectivity indicator, so it doesn't contradict
 * `AppShell.tsx`'s own stated Phase 6 boundary for that.
 */
export function useOnlineStatus(): boolean {
  // Defaults to true so server-rendered markup and first client paint agree (no
  // hydration mismatch) — `navigator` doesn't exist during SSR.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
