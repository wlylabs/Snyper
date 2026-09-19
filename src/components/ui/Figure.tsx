"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * How long the outgoing characters stay in the DOM, in milliseconds.
 *
 * The movement itself is `--dur-roll` in the stylesheet — this is only the timer
 * that clears away what has already left the screen, so it has to outlast that
 * duration plus the longest cascade below. Overrunning costs nothing: a
 * character whose animation has finished is sitting at zero opacity, and
 * dropping it changes nothing the reader can see.
 */
const SETTLE = 460;

/** How many characters deep the cascade goes before every later one moves with it. */
const CASCADE = 5;

/**
 * How much longer or shorter a figure may get and still be read as the same
 * figure with different characters in it.
 */
const SPLIT = 2;

type Place = {
  /** The character that belongs here now; absent where the figure got shorter. */
  now?: string;
  /** The character leaving here; absent where nothing is leaving. */
  was?: string;
  /** Where this place sits in the cascade, or -1 when it is not moving. */
  step: number;
};

/**
 * The two figures laid against each other, character by character, from the
 * right.
 *
 * From the right because that is the end that holds still. Every figure in this
 * app is right-aligned and most of them carry a unit — `135.873,41 MEOWTON`,
 * `4,2%` — so pairing from the left would shift the whole tail by one the moment
 * a digit is added and set eight settled characters moving for a change that
 * happened in the number. Pairing from the right leaves the unit alone and moves
 * the digits, which is where the change actually was.
 */
function places(now: string, was: string | undefined): Place[] {
  const to = [...now];
  const from = was === undefined ? undefined : [...was];

  /*
   * Two figures of nearly the same length are one figure with different
   * characters in it, and laying them against each other shows exactly that.
   * Two figures of very different lengths are not. Pairing those leaves a run
   * of characters with nothing to take their place, and a place with nothing
   * arriving in it has no width — so the whole run would fade out stacked on
   * one spot. A quote going to a dash is the case that matters, and eighteen
   * characters piled on one reads far worse than the flicker this replaces.
   *
   * So past a couple of characters the old figure is not ghosted at all: the
   * new one simply arrives, which is what a figure appearing should look like.
   */
  const paired =
    from !== undefined && Math.abs(to.length - from.length) <= SPLIT ? from : undefined;
  const span = paired ? Math.max(to.length, paired.length) : to.length;
  const lead = span - to.length;
  const fromLead = paired ? span - paired.length : 0;

  let moving = 0;
  const laid: Place[] = [];
  for (let place = 0; place < span; place++) {
    const next = place >= lead ? to[place - lead] : undefined;
    const prev = paired && place >= fromLead ? paired[place - fromLead] : undefined;
    /* Nothing to compare against on the first render: the figure is just there. */
    const turns = from !== undefined && (!paired || prev !== next);
    laid.push({
      now: next,
      was: turns ? prev : undefined,
      step: turns ? Math.min(moving++, CASCADE) : -1,
    });
  }
  return laid;
}

/**
 * A figure that changes in front of the reader instead of behind their back.
 *
 * Every number on the trading surfaces is an answer from the chain, and a new
 * answer used to arrive the way a swapped label does: the old digits were simply
 * not there any more and different ones were, in the same frame. On a panel of
 * six rows that all re-quote together that does not read as six numbers
 * updating — it reads as the panel breaking, which is exactly what it was
 * reported as.
 *
 * So the characters that changed move and the ones that did not stay put. What
 * arrives rises into place and what it replaced leaves upward, the way a wheel
 * turns forward, and only the places where the two figures actually differ take
 * part: tapping a bigger stake turns the digits and leaves the ticker beside
 * them alone. Nothing overshoots and nothing bounces, per the motion scale in
 * `globals.css` — an instrument that springs reads as imprecise.
 *
 * It takes the figure already formatted rather than a number, which is the whole
 * reason this is a component and not a dependency. The libraries in this corner
 * of npm are built on `Intl.NumberFormat` and animate between two numbers they
 * format themselves; this app's figures come out of its own formatters, which
 * write `12,4M` with the market's magnitude marks and the reader's decimal
 * comma, and `0,0₇421` with a counted run of zeros. No `Intl` option produces
 * either, so a number-in library could not render the figures this app shows.
 * Working on the formatted string instead animates whatever the formatter said,
 * including the units, the marks and the subscripts.
 */
export function Figure({
  value,
  pending = false,
  className = "",
}: {
  /** The figure, already formatted — including any unit, sign or mark. */
  value: string;
  /**
   * True while a fresher answer is still out. The figure holds the last one it
   * had and goes quiet, which is the honest state: it is a real number that is
   * no longer current, and blanking it to a dash said instead that the chain had
   * nothing to say.
   */
  pending?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const [leaving, setLeaving] = useState<string>();
  /*
   * Which turn is on screen. The places are keyed on it so that a figure
   * changing twice in a row remounts them and starts the movement again — a
   * class put back on an element that already had it does not replay its
   * animation.
   */
  const [turn, setTurn] = useState(0);

  const settle = useRef<number>(undefined);
  useEffect(
    () => () => {
      if (settle.current !== undefined) window.clearTimeout(settle.current);
    },
    [],
  );

  useEffect(() => {
    if (value === shown) return;
    setLeaving(shown);
    setShown(value);
    setTurn((count) => count + 1);
    if (settle.current !== undefined) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setLeaving(undefined), SETTLE);
  }, [value, shown]);

  return (
    <span className={`fig ${pending ? "fig-pending" : ""} ${className}`}>
      {places(shown, leaving).map((place, index) => (
        <span
          key={`${turn}:${index}`}
          className={`fig-slot ${place.step >= 0 ? "fig-turn" : ""}`}
          style={place.step > 0 ? ({ "--fig-step": place.step } as CSSProperties) : undefined}
        >
          {/*
           * The character on its way out is hidden from assistive technology,
           * so a figure mid-turn is never read as both of its values at once.
           * What is left is the text the row would have carried anyway, which is
           * also what a reader copying the figure gets.
           */}
          {place.was !== undefined && (
            <span className="fig-out" aria-hidden="true">
              {place.was}
            </span>
          )}
          {place.now !== undefined && <span className="fig-in">{place.now}</span>}
        </span>
      ))}
    </span>
  );
}
