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

export type StatusDomain =
  | 'task'
  | 'order'
  | 'line'
  | 'inventory'
  | 'incident'
  | 'severity'
  | 'reception'
  | 'condition'
  | 'quantity';

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
  // `warn`, not `late`: blocked work needs attention but is not somebody's
  // failure to act, and giving it the overdue red would say it is.
  'task.blocked':   { key: 'task.blocked',     tone: 'warn' },

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
  // `done`, not `skipped`. A resolved difference is a signed-off outcome — an
  // admin looked at it and recorded why it stands. Rendering it in the grey
  // reserved for "somebody declined to do this" said the opposite, and it was
  // the one place two unrelated meanings shared a colour on purpose.
  'inventory.resolved':    { key: 'inventory.statusResolved',   tone: 'done' },

  /* --- incidents --- */
  'incident.open':            { key: 'incident.status.open',           tone: 'neutral' },
  'incident.investigating':   { key: 'incident.status.investigating',  tone: 'accent' },
  'incident.action_required': { key: 'incident.status.actionRequired', tone: 'warn' },
  'incident.resolved':        { key: 'incident.status.resolved',       tone: 'done' },
  // Quiet on purpose. A closed incident is finished work, and a loud chip on
  // a list of them would compete with the ones that still need somebody.
  'incident.closed':          { key: 'incident.status.closed',         tone: 'neutral' },

  /* --- incident severity ---
     A separate domain rather than a fifth status: severity is how bad it is,
     status is how far along it is, and an incident always has both. The
     escalation walks the existing palette instead of introducing colours. */
  'severity.low':      { key: 'incident.severity.low',      tone: 'neutral' },
  'severity.medium':   { key: 'incident.severity.medium',   tone: 'accent' },
  'severity.high':     { key: 'incident.severity.high',     tone: 'warn' },
  'severity.critical': { key: 'incident.severity.critical', tone: 'late' },

  /* --- goods receptions ---
     A draft is `warn`, matching an order draft: both mean "started and not
     yet a statement about anything", and both are something somebody has to
     come back to. RECEIVED and CHECKING share `accent` because they are both
     work in progress; the distinction between them is in the label, and
     giving them different colours would imply one is worse than the other. */
  'reception.draft':     { key: 'gr.statusLabel.draft',     tone: 'warn' },
  'reception.received':  { key: 'gr.statusLabel.received',  tone: 'accent' },
  'reception.checking':  { key: 'gr.statusLabel.checking',  tone: 'accent' },
  'reception.completed': { key: 'gr.statusLabel.completed', tone: 'done' },

  /* --- the condition goods arrived in ---
     Separate from the reception's status for the same reason severity is
     separate from an incident's: a delivery always has both, and "completed"
     says nothing about whether the pallet was wet. */
  'condition.good':              { key: 'gr.conditionLabel.good',             tone: 'done' },
  'condition.damaged':           { key: 'gr.conditionLabel.damaged',          tone: 'late' },
  'condition.partially_damaged': { key: 'gr.conditionLabel.partiallyDamaged', tone: 'warn' },
  'condition.other_issue':       { key: 'gr.conditionLabel.otherIssue',       tone: 'warn' },

  /* --- the quantity check ---
     `not_checked` is deliberately NEUTRAL and not `warn`: nobody has failed
     yet. A pallet in the cold store waiting to be opened is an ordinary
     state, and colouring it as a problem would train people to ignore it. */
  'quantity.not_checked': { key: 'gr.quantityLabel.notChecked', tone: 'neutral' },
  'quantity.checked_ok':  { key: 'gr.quantityLabel.checkedOk',  tone: 'done' },
  'quantity.discrepancy': { key: 'gr.quantityLabel.discrepancy', tone: 'late' },
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
