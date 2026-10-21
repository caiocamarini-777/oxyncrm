"use client";

import { useEffect, useState } from "react";

/**
 * Fecha modal/drawer só depois que a transição (action + router.refresh) terminar.
 * Chame `markSaved()` dentro da transição, após disparar o refresh; o `close`
 * roda quando `pending` volta a false.
 */
export function useCloseAfterSave(pending: boolean, close: () => void) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (saved && !pending) close();
  }, [saved, pending, close]);
  return () => setSaved(true);
}
