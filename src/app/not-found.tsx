"use client";

import Link from "next/link";
import { useI18n } from "@/hooks/useI18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <span className="num text-[48px] leading-none text-faint">404</span>
      <div className="h-px w-12 bg-edge" />
      <p className="text-sm text-dim">{t("notFound.title")}</p>
      <Link href="/" className="btn btn-sm">
        {t("notFound.action")}
      </Link>
    </div>
  );
}
