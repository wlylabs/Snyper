import type { Metadata } from "next";
import { Holdings } from "@/components/balance/Holdings";

export const metadata: Metadata = { title: "Balance" };

export default function BalancePage() {
  return <Holdings />;
}
