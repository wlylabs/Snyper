"use client";

import { useEffect, useState } from "react";

/** Gates wallet-dependent output until the client has hydrated. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
