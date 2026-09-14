import type { SVGProps } from "react";

export type IconName =
  | "candles"
  | "crosshair"
  | "grid"
  | "stack"
  | "pulse"
  | "sliders"
  | "wallet"
  | "chevron"
  | "close"
  | "copy"
  | "check"
  | "external"
  | "plus"
  | "swap"
  | "refresh"
  | "search"
  | "power"
  | "pause"
  | "play"
  | "trash"
  | "alert"
  | "qr"
  | "download"
  | "sun"
  | "moon"
  | "link"
  | "arrow-up"
  | "arrow-down";

const PATHS: Record<IconName, string> = {
  candles: "M8 4v3M8 15v5M5.5 7h5v8h-5zM16 4v5M16 17v3M13.5 9h5v8h-5z",
  crosshair: "M12 3v4M12 17v4M3 12h4M17 12h4M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  stack: "M12 3 3 7.5 12 12l9-4.5L12 3ZM3 12.5 12 17l9-4.5M3 17 12 21.5 21 17",
  pulse: "M3 12h3.5l2.5-6 4 12 2.5-6H21",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M16 4v6M8 14v6",
  wallet: "M3 7.5A2.5 2.5 0 0 1 5.5 5H18v2.5M3 7.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2.5M3 7.5h16a2 2 0 0 1 2 2v2.5M21 12h-4a1.5 1.5 0 0 0 0 3h4",
  chevron: "m6 9 6 6 6-6",
  close: "m6 6 12 12M18 6 6 18",
  copy: "M9 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9ZM5 15V5a2 2 0 0 1 2-2h10",
  check: "m4 12.5 5 5L20 6.5",
  external: "M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4",
  plus: "M12 5v14M5 12h14",
  swap: "M7 4v14m0 0-3.5-3.5M7 18l3.5-3.5M17 20V6m0 0-3.5 3.5M17 6l3.5 3.5",
  refresh: "M20 11a8 8 0 1 0-.6 4M20 5v6h-6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4",
  power: "M12 3v9M6.5 6.8a8 8 0 1 0 11 0",
  pause: "M9 5v14M15 5v14",
  play: "M7 4.5 19 12 7 19.5z",
  trash: "M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6",
  alert: "M12 4 2.5 20h19L12 4ZM12 10v4M12 17.5h.01",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM19 14h1M19 19h1M14 19h2.5",
  download: "M12 3v12M12 15l-4-4M12 15l4-4M4 19h16",
  sun: "M12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM12 1.5v2M12 20.5v2M3.6 3.6l1.4 1.4M19 19l1.4 1.4M1.5 12h2M20.5 12h2M3.6 20.4 5 19M19 5l1.4-1.4",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z",
  link: "M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.9 6.4M13.5 10.5a4 4 0 0 0-5.7 0L5 13.3a4 4 0 1 0 5.7 5.7l1.4-1.4",
  "arrow-up": "M12 19V5M12 5l-6 6M12 5l6 6",
  "arrow-down": "M12 5v14M12 19l-6-6M12 19l6-6",
};

type Props = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 18, strokeWidth = 1.5, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
