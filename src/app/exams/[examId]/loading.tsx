import { Skeleton } from "@/components/ui/skeleton";

export default function ExamLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 w-32 rounded-md" />
        ))}
      </div>

      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
