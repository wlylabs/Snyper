/**
 * A dynamic import that survives a bad fetch.
 *
 * A chunk is a network request like any other, and the two this app splits out
 * — the wallet session and the control that reads it — are fetched on a phone
 * that may be walking between cells. Nothing in the stack retries one. The
 * import rejects, the `.catch` that was written for a build with no Privy app
 * id swallows it, and the header keeps a placeholder for the rest of the page's
 * life: no connect button, no reason given, and nothing the reader can do about
 * it short of reloading a page that looked like it had loaded. One dropped
 * request they never saw, and the wallet is gone for the visit.
 *
 * Calling the loader again is what asks for the chunk again — a failed request
 * is dropped from the bundler's own record of what it has, so the next call is
 * a fresh one rather than the cached rejection. The waits between are there
 * because whatever broke the first fetch is usually still true a moment later,
 * and the last failure is rethrown so a caller that has something to say about
 * an outage still hears about it.
 */
export async function retryImport<T>(load: () => Promise<T>, attempts = 3): Promise<T> {
  let failure: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      const wait = 400 * 2 ** (attempt - 1);
      await new Promise((resume) => setTimeout(resume, wait));
    }
    try {
      return await load();
    } catch (error) {
      failure = error;
    }
  }

  throw failure;
}
