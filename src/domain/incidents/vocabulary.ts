/**
 * The incident vocabulary, mirroring the enums in
 * 20260911090100_incidents_module.sql.
 *
 * Every value here is a STABLE IDENTIFIER, never display text. The database
 * stores 'wrong_quantity'; the dictionaries decide whether that reads as
 * "Wrong quantity", "Falsche Menge" or "Cantidad incorrecta". A translated
 * string in a column would make the reports untranslatable and the history
 * unreadable the day somebody switches language.
 */

export const INCIDENT_STATUSES = [
  'open',
  'investigating',
  'action_required',
  'resolved',
  'closed',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/**
 * WHY it happened — the step of our own process where it went wrong.
 *
 * Ordered as the work actually flows, from taking the order to handing it
 * over, with the three external parties and the two escapes at the end. A
 * report that lists causes in this order reads as a walk through the
 * operation rather than as an alphabetical list.
 */
export const INCIDENT_CAUSES = [
  'order_entry',
  'picking',
  'preparation',
  'packing',
  'dispatch',
  'transport',
  'delivery',
  'supplier',
  'customer',
  'unknown',
  'other',
] as const;
export type IncidentCause = (typeof INCIDENT_CAUSES)[number];

export const INCIDENT_RESPONSIBILITIES = [
  'internal',
  'transporter',
  'supplier',
  'customer',
  'shared',
  'unknown',
] as const;
export type IncidentResponsibility = (typeof INCIDENT_RESPONSIBILITIES)[number];

/**
 * Severity as a number, for sorting and for "high or worse" filters.
 *
 * Not the array index: the array is ordered for display and a rank that fell
 * out of that ordering would invert the moment somebody reordered the list.
 * The same reasoning as ROLE_RANK in lib/authz.
 */
export const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Severity at or above which an incident is "serious" in the summary. */
export function isSerious(severity: IncidentSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK.high;
}

/**
 * Lifecycle position, for deciding whether a status change moves forward.
 *
 * Again not the array index, for the same reason.
 */
export const STATUS_RANK: Record<IncidentStatus, number> = {
  open: 1,
  investigating: 2,
  action_required: 3,
  resolved: 4,
  closed: 5,
};

/** Still being worked on. What the default list shows and the report counts. */
export function isOpen(status: IncidentStatus): boolean {
  return STATUS_RANK[status] < STATUS_RANK.resolved;
}

export function isStatus(value: string): value is IncidentStatus {
  return (INCIDENT_STATUSES as readonly string[]).includes(value);
}
export function isSeverity(value: string): value is IncidentSeverity {
  return (INCIDENT_SEVERITIES as readonly string[]).includes(value);
}
export function isCause(value: string): value is IncidentCause {
  return (INCIDENT_CAUSES as readonly string[]).includes(value);
}
export function isResponsibility(value: string): value is IncidentResponsibility {
  return (INCIDENT_RESPONSIBILITIES as readonly string[]).includes(value);
}

/**
 * A vocabulary value in a form the i18n dictionary can hold.
 *
 * `t()` addresses nested keys by splitting on '.', so a value containing one
 * would be looked up as two levels of nesting and never found. These have no
 * dots, but they do have underscores, and the dictionaries are camelCase —
 * the same flattening `permissionKey()` does for capabilities.
 */
export function vocabularyKey(value: string): string {
  return value.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
}
