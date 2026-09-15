"use client";

import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * What the button does, which is what its glyph will do when pressed. `spin`
 * turns the icon a full revolution per press and keeps it turning while the
 * work it started is still out; `dismiss` leans the cross away on approach;
 * `add` opens the plus into a cross.
 */
type Act = "spin" | "dismiss" | "add";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  act?: Act;
  busy?: boolean;
  size?: number;
};

/**
 * An icon button that reacts in the shape of its own verb.
 *
 * The rules live in `globals.css`; what has to be here is the count. A refresh
 * that rotated only while held would snap back the instant the finger lifted,
 * so each press adds a turn and the icon rotates to the running total — it
 * always turns forwards, and it never rewinds through the revolution it just
 * made.
 */
export function IconButton({
  icon,
  act,
  busy,
  size = 14,
  className = "",
  onClick,
  style,
  ...rest
}: Props) {
  const [turns, setTurns] = useState(0);

  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      data-act={act}
      data-busy={busy ? "true" : undefined}
      style={{ ...(style ?? {}), "--turn": turns } as CSSProperties}
      onClick={(event) => {
        if (act === "spin") setTurns((count) => count + 1);
        onClick?.(event);
      }}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
