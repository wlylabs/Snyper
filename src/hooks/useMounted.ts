"use client";

import { useEffect, useState } from "react";

/*
 * Once per document, not once per mount.
 *
 * This flag is what stops a remount from replaying the skeletons. The wallet
 * session arrives as a lazily loaded provider, and the frame it mounts in it
 * replaces the tree beneath it — the header, the status strip and the page are
 * all built again from nothing. Without the flag every gate in the app would
 * answer `false` on the way through, and a reader would watch the header they
 * had just finished reading dissolve back into placeholders.
 *
 * Module state rather than a ref, because the question is not about any one
 * component: it is whether this document has rendered on the client yet, and
 * the answer is the same everywhere. Effects do not run on the server, so there
 * it is never set, and the first client render still matches the HTML.
 */
let rendered = false;

/** Gates wallet-dependent output until the client has hydrated. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(rendered);

  useEffect(() => {
    rendered = true;
    setMounted(true);
  }, []);

  return mounted;
}
