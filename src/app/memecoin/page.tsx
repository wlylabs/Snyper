import type { Metadata } from "next";
import { BlankPage } from "@/components/shell/BlankPage";

export const metadata: Metadata = { title: "Memes" };

export default function MemecoinPage() {
  return (
    <BlankPage
      title="page.memecoin.title"
      subtitle="page.memecoin.subtitle"
      empty="page.memecoin.empty"
      hint="page.memecoin.hint"
    />
  );
}
