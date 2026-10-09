import { Skeleton } from '@/components/ui/primitives';

/**
 * What every screen shows while its data is on the way.
 *
 * Without it a tap on the menu changed nothing until the server had finished
 * every query of the next page, so half a second of waiting read as the app
 * being stuck. The menu stays where it is; only the content area is replaced.
 */
export default function AppLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-4 h-7 w-48" />
      <Skeleton className="mb-4 h-24 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
