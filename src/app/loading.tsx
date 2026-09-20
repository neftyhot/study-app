import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a route's data loads.
 *
 * Shaped like the page it replaces rather than a spinner, so the layout does
 * not jump when the real content arrives.
 */
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>

      <Skeleton className="h-44 rounded-xl" />
    </div>
  );
}
