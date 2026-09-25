import type { Metadata } from "next";
import { Activity } from "@/components/activity/Activity";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return <Activity />;
}
