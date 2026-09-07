'use client';

import { useI18n, type MessageKey } from '@/i18n';
import { Badge, type Tone } from '@/components/ui/primitives';

/**
 * How every status in the system is presented.
 *
 * The four ENUMS stay separate and untouched — an occurrence being "skipped",
 * an order being "cancelled", a line being "over-allocated" and an inventory
 * being "to review" genuinely are different things, and collapsing them would
 * be the opposite of this exercise.
 *
 * What was duplicated is the PRESENTATION. Four independent label sets across
 * three locale files (`status.*`, `orders.status*`, `prep.status*`,
 * `inventory.status*`), two badge components, and a scattering of inline
 * `<Badge tone=…>` calls — with the tone for each state decided separately at
 * each site. "Completed" appeared four times per language, and two states read
 * the same while meaning different things, in the same colour, by coincidence
 * rather than by decision.
 *
 * One registry, keyed by `domain.status`. Adding a locale is now one edit per
 * language instead of four, and a tone change is one line.
 */

export type StatusDomain = 'task' | 'order' | 'line' | 'inventory';

interface Presentation {
  key: MessageKey;
  tone: Tone;
}

export const STATUS_PRESENTATION: Record<string, Presentation> = {
  /* --- task occurrences --- */
  'task.pending':   { key: 'status.pending',   tone: 'neutral' },
  'task.completed': { key: 'status.completed', tone: 'done' },
  'task.skipped':   { key: 'status.skipped',   tone: 'skipped' },
  // Not a stored status: derived from the due date. Listed here so an overdue
  // chip cannot be tinted differently from screen to screen.
  'task.overdue':   { key: 'status.overdue',   tone: 'late' },

  /* --- orders --- */
  'order.draft':     { key: 'orders.statusDraft',     tone: 'warn' },
  'order.confirmed': { key: 'orders.statusConfirmed', tone: 'accent' },
  'order.cancelled': { key: 'orders.statusCancelled', tone: 'late' },

  /* --- order lines (derived from allocations, never stored) --- */
  'line.not_prepared':   { key: 'prep.statusNotPrepared', tone: 'neutral' },
  'line.partial':        { key: 'prep.statusPartial',     tone: 'warn' },
  'line.complete':       { key: 'prep.statusComplete',    tone: 'done' },
  'line.over_allocated': { key: 'prep.statusOver',        tone: 'late' },

  /* --- inventories and their items --- */
  'inventory.in_progress': { key: 'inventory.statusInProgress', tone: 'accent' },
  'inventory.completed':   { key: 'inventory.statusCompleted',  tone: 'done' },
  'inventory.to_review':   { key: 'inventory.statusToReview',   tone: 'late' },
  'inventory.resolved':    { key: 'inventory.statusResolved',   tone: 'skipped' },
};

/** Look up a presentation, or null when the pair is not a known status. */
export function statusPresentation(domain: StatusDomain, status: string): Presentation | null {
  return STATUS_PRESENTATION[`${domain}.${status}`] ?? null;
}

/**
 * The chip.
 *
 * Renders nothing for an unknown pair rather than an empty badge — a blank
 * chip reads as a state, and there is no state here to report.
 */
export function StatusChip({
  domain,
  status,
  className,
}: {
  domain: StatusDomain;
  status: string;
  className?: string;
}) {
  const { t } = useI18n();
  const presentation = statusPresentation(domain, status);
  if (!presentation) return null;

  return (
    <Badge tone={presentation.tone} className={className}>
      {t(presentation.key)}
    </Badge>
  );
}
