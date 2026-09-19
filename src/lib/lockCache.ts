import type { Lock } from "./lock";

/**
 * Verdicts kept between visits, so a list of them costs one reading.
 *
 * Checking a pool is the most expensive question this app asks about one: a log
 * query, a receipt per funding transaction, and three multicalls. Asking it for
 * every row of a list is affordable exactly once, and a reader who reloads, or
 * closes a standalone window and opens it again, should not pay for it twice.
 *
 * What is stored is the reading, not a judgement about it — the same four
 * figures `readLock` returns, so the list and the sheet cannot drift into
 * disagreeing about a pool. The bigints go out as strings because JSON has no
 * way to carry one, and come back through `BigInt` rather than `Number`, which
 * would quietly round a position's liquidity into a different number.
 */

const KEY = "snyper.locks.v1";

/**
 * How long a stored reading still describes the pool.
 *
 * Ten minutes, and the number is chosen for the direction a stale one is wrong
 * in rather than for how long a position usually sits. Burning is one-way — a
 * burn address cannot hand a position back — so a stored "burned" cannot become
 * a lie about the part that was burned. What it can become is an overstatement:
 * somebody adds withdrawable liquidity beside it and the share should have
 * fallen. Ten minutes bounds that, and the sheet a reader opens before trading
 * reads the pool again regardless, so nothing is ever acted on from here alone.
 */
const TTL = 10 * 60 * 1000;

/**
 * How many pools are worth remembering.
 *
 * The screener describes at most forty and the launches list another forty, so
 * this holds several screens' worth and then drops whatever was read longest
 * ago. A cap is here because the alternative is a store that grows for as long
 * as somebody keeps the app installed.
 */
const LIMIT = 200;

type Stored = {
  burned: string;
  open: string;
  unread: string;
  backsPrice?: boolean;
  partial: boolean;
  unreadable?: boolean;
  /** When the reading was taken. */
  at: number;
};

type Shelf = Record<string, Stored>;

/*
 * Held in memory as well as on disk. Every row of the list reads this on every
 * render, and parsing a few hundred entries out of localStorage that often is
 * work that shows up as a dropped frame while scrolling.
 */
let shelf: Shelf | undefined;

function load(): Shelf {
  if (shelf) return shelf;
  try {
    const raw = window.localStorage.getItem(KEY);
    shelf = raw ? (JSON.parse(raw) as Shelf) : {};
  } catch {
    // A private window, blocked site data, or something else in this key.
    shelf = {};
  }
  return shelf;
}

/*
 * Writing is deferred to the end of the tick. Filling a list settles a few
 * dozen readings within a second or two of each other, and each one would
 * otherwise serialise the whole shelf and hand it to a synchronous storage API.
 */
let pending = false;

function save(): void {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    if (!shelf) return;
    try {
      const entries = Object.entries(shelf);
      if (entries.length > LIMIT) {
        entries.sort((a, b) => b[1].at - a[1].at);
        shelf = Object.fromEntries(entries.slice(0, LIMIT));
      }
      window.localStorage.setItem(KEY, JSON.stringify(shelf));
    } catch {
      /* Out of quota or refused. The readings still stand in memory. */
    }
  });
}

/** A reading kept for this pool, if one is still recent enough to use. */
export function cachedLock(pool: string): { lock: Lock; at: number } | undefined {
  if (typeof window === "undefined") return undefined;
  const held = load()[pool.toLowerCase()];
  if (!held) return undefined;
  if (Date.now() - held.at > TTL) return undefined;
  try {
    return {
      at: held.at,
      lock: {
        burned: BigInt(held.burned),
        open: BigInt(held.open),
        unread: BigInt(held.unread),
        backsPrice: held.backsPrice,
        partial: held.partial,
        unreadable: held.unreadable,
      },
    };
  } catch {
    // A shelf written by something else, or by a version that stored other
    // shapes. One unreadable entry is not worth failing a row over.
    return undefined;
  }
}

/** Keep a reading, replacing whatever was held for this pool. */
export function rememberLock(pool: string, lock: Lock): void {
  if (typeof window === "undefined") return;
  const held = load();
  held[pool.toLowerCase()] = {
    burned: lock.burned.toString(),
    open: lock.open.toString(),
    unread: lock.unread.toString(),
    backsPrice: lock.backsPrice,
    partial: lock.partial,
    unreadable: lock.unreadable,
    at: Date.now(),
  };
  save();
}
