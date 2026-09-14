import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <span className="num text-[48px] leading-none text-faint">404</span>
      <div className="h-px w-12 bg-edge" />
      <p className="text-sm text-dim">That route is not part of the terminal.</p>
      <Link href="/" className="btn btn-sm">
        Back to terminal
      </Link>
    </div>
  );
}
