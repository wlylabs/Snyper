/**
 * The Snyper mark: a lock-on frame — four corner brackets closing on a centre
 * block. It is one closed silhouette at any size, so it survives a 16px favicon
 * the way the old hairline reticle did not.
 *
 * Two forms, same 512 grid as the installed app icon:
 *   tile — the brand square (accent ground, mark knocked out). Use it wherever
 *          the logo sits on a page; it carries its own contrast, so it reads on
 *          a white header as well as a black one.
 *   mark — the bare glyph in currentColor, for single-colour contexts.
 */

const BRACKETS = "M112 190V112H190M322 112H400V190M400 322V400H322M190 400H112V322";

function Glyph({ color }: { color: string }) {
  return (
    <>
      <path
        d={BRACKETS}
        fill="none"
        stroke={color}
        strokeWidth={52}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="210" y="210" width="92" height="92" rx="24" fill={color} />
    </>
  );
}

export function Logo({
  size = 28,
  variant = "tile",
  className,
  title,
}: {
  size?: number;
  variant?: "tile" | "mark";
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
      {variant === "tile" ? (
        <>
          <rect width="512" height="512" rx="114" fill="var(--color-accent)" />
          {/* Keeps the tile edge defined where the accent sits on a pale ground. */}
          <rect
            x="1"
            y="1"
            width="510"
            height="510"
            rx="113"
            fill="none"
            stroke="var(--color-accent-ink)"
            strokeOpacity={0.14}
            strokeWidth={2}
          />
          <g transform="translate(256 256) scale(0.62) translate(-256 -256)">
            <Glyph color="var(--color-accent-ink)" />
          </g>
        </>
      ) : (
        <Glyph color="currentColor" />
      )}
    </svg>
  );
}
