import type { Metadata } from "next";
import { Screener } from "@/components/memecoin/Screener";

export const metadata: Metadata = { title: "Memes" };

export default function MemecoinPage() {
  return <Screener />;
}
