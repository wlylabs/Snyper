/**
 * Lets a plain Node script import this app's TypeScript modules.
 *
 * Next resolves `@/lib/x` and extensionless relative imports through its own
 * bundler; Node does neither. Rather than keep a second copy of the logic under
 * test — which is a test of the copy — this hook teaches Node the same two
 * rules, so a script can import the exact modules the app ships.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, next) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = new URL(spec.slice(2), SRC).href;

  const relative = spec.startsWith(".") || spec.startsWith("file:");
  if (relative && !/\.(ts|tsx|mjs|js|json)$/.test(spec)) {
    const url = spec.startsWith("file:")
      ? new URL(spec)
      : new URL(spec, context.parentURL);
    for (const extension of EXTENSIONS) {
      const candidate = new URL(url.href + extension);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
  }

  return next(spec, context);
}
