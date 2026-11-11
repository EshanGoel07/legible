import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-3 h-5 w-[32rem]" />
      <div className="mt-10 grid grid-cols-3 gap-5">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-56" />)}
      </div>
    </div>
  );
}
