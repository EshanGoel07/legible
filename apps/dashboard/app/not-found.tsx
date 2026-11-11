import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <div className="text-6xl font-bold text-slate-300">404</div>
      <p className="mt-2 text-slate-600">No such page. <Link href="/tools" className="font-medium text-slate-900 underline">Go to tools</Link></p>
    </div>
  );
}
