"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { useI18n } from "@/hooks/useI18n";

type SheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

export function Sheet({ open, title, onClose, children, footer }: SheetProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} role="presentation" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grab md:hidden" />
        <header className="panel-head shrink-0">
          <span className="lbl">{title}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="shrink-0 border-t border-line p-3">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}
