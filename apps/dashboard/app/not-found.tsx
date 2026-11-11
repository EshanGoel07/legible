import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-28 text-center">
      <div className="font-mono text-8xl font-semibold tracking-tighter text-ink/15">404</div>
      <p className="mt-3 text-[17px] text-ink/70">No such page. <Link href="/tools" className="font-semibold text-ink underline underline-offset-4">Go to tools</Link></p>
    </div>
  );
}
