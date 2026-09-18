import type { Metadata } from "next";
import { BlankPage } from "@/components/shell/BlankPage";

export const metadata: Metadata = { title: "Memes" };

export default function DiscoverPage() {
  return (
    <BlankPage
      title="page.discover.title"
      subtitle="page.discover.subtitle"
      empty="page.discover.empty"
      hint="page.discover.hint"
    />
  );
}
