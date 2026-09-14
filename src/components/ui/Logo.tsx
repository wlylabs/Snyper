"use client";

/**
 * The Snyper mark: a broken scope ring around a crosshair whose north arm
 * resolves into a trend arrow. Drawn on a 512 grid so the component, the
 * favicon and the installed app icon are the same artwork at every size.
 */
export function Logo({
  size = 28,
  className,
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth={19} fill="none">
        <circle
          cx="256"
          cy="256"
          r="134"
          strokeDasharray="140.3 70.2"
          transform="rotate(15 256 256)"
        />
        <path d="M256 186V96M256 326v90M186 256H96M326 256h90" />
      </g>
      <path d="M256 52l42 56h-84z" fill="currentColor" />
      <rect x="238" y="238" width="36" height="36" fill="currentColor" />
    </svg>
  );
}
