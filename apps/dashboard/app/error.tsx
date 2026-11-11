"use client";
import { ErrorCard } from "@/components/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <ErrorCard title="This page failed to load" message={error.message} hint="Check that runs/ and the manifest are readable, then retry." />
      <div className="mt-4 text-center"><button onClick={reset} className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white">Retry</button></div>
    </div>
  );
}
