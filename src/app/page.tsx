import type { Metadata } from "next";
import { Terminal } from "@/components/snipe/Terminal";

export const metadata: Metadata = { title: "Snyper" };

export default function HomePage() {
  return <Terminal />;
}
