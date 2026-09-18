import type { Metadata } from "next";
import { BlankPage } from "@/components/shell/BlankPage";

export const metadata: Metadata = { title: "Balance" };

export default function BalancePage() {
  return (
    <BlankPage
      title="page.balance.title"
      subtitle="page.balance.subtitle"
      empty="page.balance.empty"
      hint="page.balance.hint"
    />
  );
}
