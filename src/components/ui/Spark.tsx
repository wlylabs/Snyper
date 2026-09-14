"use client";

import { useId } from "react";
import type { PricePoint } from "@/lib/types";

/**
 * Observed price ticks rendered as discrete columns rather than a smooth area —
 * every column is a real reading taken by the engine, nothing is interpolated.
 */
export function Spark({
  points,
  height = 64,
  className = "",
}: {
  points: PricePoint[];
  height?: number;
  className?: string;
}) {
  const gradientId = useId();
  if (points.length < 2) {
    return (
      <div
        className={`flex items-center justify-center border border-dashed border-line ${className}`}
        style={{ height }}
      >
        <span className="lbl">Awaiting ticks</span>
      </div>
    );
  }

  const width = 300;
  const values = points.map((p) => p.p);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max || 1;
  const step = width / (points.length - 1 || 1);
  const rising = values[values.length - 1] >= values[0];
  const stroke = rising ? "var(--color-accent)" : "var(--color-short)";

  const path = points
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point.p - min) / span) * (height - 6) - 3;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const area = `${path} L${width} ${height} L0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height, width: "100%" }}
      role="img"
      aria-label="Observed price ticks"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
      {points.map((point, index) => {
        if (index % 6 !== 0) return null;
        const x = index * step;
        return (
          <line
            key={point.t}
            x1={x}
            x2={x}
            y1={height - 3}
            y2={height - 7}
            stroke="var(--color-edge)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
