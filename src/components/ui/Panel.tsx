import type { ReactNode } from "react";

type PanelProps = {
  label?: string;
  meta?: ReactNode;
  action?: ReactNode;
  ticked?: boolean;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
};

export function Panel({
  label,
  meta,
  action,
  ticked,
  bodyClassName = "panel-body",
  className = "",
  children,
}: PanelProps) {
  return (
    <section className={`panel ${ticked ? "ticked" : ""} ${className}`}>
      {(label || meta || action) && (
        <header className="panel-head">
          <span className="lbl truncate">{label}</span>
          <span className="flex items-center gap-2">
            {meta}
            {action}
          </span>
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Row({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: "long" | "short" | "warn" }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className={`kv-v wrap-any ${tone ?? ""}`}>{v}</span>
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="h-px w-10 bg-edge" />
      <p className="text-sm text-dim">{title}</p>
      {hint && <p className="max-w-xs text-xs leading-relaxed text-faint">{hint}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`skel ${className}`} />;
}
