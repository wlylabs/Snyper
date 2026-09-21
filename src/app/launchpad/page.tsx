import type { Metadata } from "next";
import { Screener } from "@/components/launchpad/Screener";

export const metadata: Metadata = { title: "Launchpad" };

export default function LaunchpadPage() {
  return <Screener />;
}
