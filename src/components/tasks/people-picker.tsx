'use client';

import { Checkbox } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { OneOffPerson } from '@/components/calendar/one-off-dialog';

/**
 * Tick the people who do an activity. Each one ticked gets their own copy of
 * every day to complete; ticking nobody leaves it to the whole team.
 */
export function PeoplePicker({
  people,
  selected,
  onChange,
  disabled,
  className,
}: {
  people: OneOffPerson[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const chosen = new Set(selected);
  return (
    <div
      className={cn(
        'max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border bg-surface px-3 py-2.5',
        className,
      )}
    >
      {people.map((p) => (
        <Checkbox
          key={p.id}
          label={p.name}
          checked={chosen.has(p.id)}
          disabled={disabled}
          onChange={(e) =>
            onChange(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))
          }
        />
      ))}
    </div>
  );
}
