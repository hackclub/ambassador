"use client";

import { useCallback, useEffect, useState } from "react";

import {
  listPendingPosterCaptures,
  onPendingPosterCapturesChange,
  type PendingPosterCapture,
} from "@/lib/offline/poster-capture-queue";

/** Live-reads the offline poster-capture queue, refreshing whenever it changes in this tab. */
export function usePendingPosterCaptures() {
  const [captures, setCaptures] = useState<PendingPosterCapture[]>([]);

  const refresh = useCallback(() => {
    listPendingPosterCaptures()
      .then(setCaptures)
      .catch(() => setCaptures([]));
  }, []);

  useEffect(() => {
    refresh();
    return onPendingPosterCapturesChange(refresh);
  }, [refresh]);

  return { captures, refresh };
}
