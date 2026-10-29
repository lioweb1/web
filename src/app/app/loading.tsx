import { Skeleton, TableSkeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <Skeleton className="mb-2 h-6 w-48" />
      <Skeleton className="mb-6 h-4 w-96 max-w-full" />
      <div className="rounded-lg border border-border bg-surface">
        <TableSkeleton />
      </div>
    </div>
  );
}
