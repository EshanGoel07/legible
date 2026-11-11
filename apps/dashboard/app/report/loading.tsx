import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div>
      <Skeleton className="h-9 w-80" />
      <Skeleton className="mt-3 h-5 w-[40rem]" />
      <div className="mt-8 grid grid-cols-2 gap-6"><Skeleton className="h-60" /><Skeleton className="h-60" /></div>
      <div className="mt-10 space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
    </div>
  );
}
