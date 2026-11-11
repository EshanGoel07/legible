"use client";
import { ErrorCard } from "@/components/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <ErrorCard title="This page failed to load" message={error.message} hint="Check that runs/ and the manifest are readable, then retry." />
      <div className="-mt-8 pb-16 text-center"><button onClick={reset} className="rounded-lg bg-ink px-5 py-2.5 font-semibold text-white hover:bg-ink-2">Retry</button></div>
    </div>
  );
}
