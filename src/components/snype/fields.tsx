"use client";

import { Icon } from "@/components/ui/Icon";
import { TokenBadge } from "@/components/terminal/TokenPicker";
import type { Token } from "@/lib/tokens";

export function PairButton({
  token,
  caption,
  placeholder,
  onClick,
}: {
  token?: Token;
  caption: string;
  placeholder: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="row-link panel flex items-center gap-2.5 p-2.5"
      onClick={onClick}
    >
      {token ? <TokenBadge token={token} size={26} /> : <span className="h-[26px] w-[26px] border border-line" />}
      <span className="min-w-0 flex-1 text-left">
        <span className="lbl block">{caption}</span>
        <span className="block truncate text-[13px] font-semibold">
          {token?.symbol ?? placeholder}
        </span>
      </span>
      <Icon name="chevron" size={12} className="text-faint" />
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  hint,
  numeric = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  numeric?: boolean;
}) {
  return (
    <label className="block">
      <span className="lbl mb-1.5 block">{label}</span>
      <input
        className="field"
        value={value}
        inputMode={numeric ? "decimal" : "text"}
        onChange={(event) =>
          onChange(numeric ? event.target.value.replace(/[^\d.]/g, "") : event.target.value)
        }
      />
      {hint && <span className="mt-1 block text-[10px] text-faint">{hint}</span>}
    </label>
  );
}
