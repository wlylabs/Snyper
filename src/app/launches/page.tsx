import type { Metadata } from "next";
import { Screener } from "@/components/launches/Screener";

export const metadata: Metadata = { title: "Launches" };

export default function LaunchesPage() {
  return <Screener />;
}
