"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import { useI18n } from "@/hooks/useI18n";

type Tone = "info" | "ok" | "error";

type ToastItem = {
  id: string;
  tone: Tone;
  message: string;
  detail?: string;
  href?: string;
};

type ToastApi = {
  push: (toast: Omit<ToastItem, "id">) => void;
};

const ToastContext = createContext<ToastApi | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setItems((current) => [...current.slice(-3), { ...toast, id }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 7000);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--shell-tabs)+env(safe-area-inset-bottom)+12px)] z-[70] flex flex-col gap-2 md:inset-x-auto md:right-4 md:bottom-4 md:w-80">
        {items.map((item) => (
          <div
            key={item.id}
            className="panel pointer-events-auto flex items-start gap-3 p-3"
            role="status"
          >
            <span
              className={`dot mt-1.5 ${
                item.tone === "ok" ? "dot-live" : item.tone === "error" ? "dot-short" : ""
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-wide">{item.message}</p>
              {item.detail && (
                <p className="num mt-1 truncate text-[11px] text-dim">{item.detail}</p>
              )}
              {item.href && (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="lbl mt-2 inline-flex items-center gap-1 text-accent-text"
                >
                  {t("common.explorer")}
                  <Icon name="external" size={11} />
                </a>
              )}
            </div>
            <button
              type="button"
              className="text-faint transition-colors hover:text-ink"
              onClick={() => setItems((current) => current.filter((i) => i.id !== item.id))}
              aria-label={t("toast.dismiss")}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
