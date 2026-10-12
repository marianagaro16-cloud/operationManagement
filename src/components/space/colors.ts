import { TOPIC_COLORS, type TopicColor } from '@/types/reminders';

/*
 * The colours of "Mi espacio": the same small palette as the topics of
 * personal tasks, so a person learns one set. Written out in full because
 * Tailwind only keeps the class names it can read here.
 */

export type SpaceColor = TopicColor;
export const SPACE_COLORS = TOPIC_COLORS;

/** A person's own colour for their workspace. Red is left out: there it means late. */
export const ACCENT_COLORS = SPACE_COLORS.filter((c) => c !== 'red');

export const isSpaceColor = (value: unknown): value is SpaceColor => SPACE_COLORS.includes(value as SpaceColor);

/** The band across the top of a note page. */
export const COVER_BAND: Record<SpaceColor, string> = {
  slate: 'from-slate-300 to-slate-100 dark:from-slate-600/70 dark:to-slate-800/40',
  red: 'from-red-300 to-rose-100 dark:from-red-700/70 dark:to-red-900/40',
  orange: 'from-orange-300 to-amber-100 dark:from-orange-700/70 dark:to-orange-900/40',
  amber: 'from-amber-300 to-yellow-100 dark:from-amber-600/70 dark:to-amber-900/40',
  green: 'from-green-300 to-lime-100 dark:from-green-700/70 dark:to-green-900/40',
  teal: 'from-teal-300 to-cyan-100 dark:from-teal-700/70 dark:to-teal-900/40',
  blue: 'from-blue-300 to-sky-100 dark:from-blue-700/70 dark:to-blue-900/40',
  violet: 'from-violet-300 to-fuchsia-100 dark:from-violet-700/70 dark:to-violet-900/40',
  pink: 'from-pink-300 to-rose-100 dark:from-pink-700/70 dark:to-pink-900/40',
};

/** A swatch to choose it by. */
export const SWATCH: Record<SpaceColor, string> = {
  slate: 'bg-slate-400',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-400',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
};

/** An icon drawn in it. */
export const TINT: Record<SpaceColor, string> = {
  slate: 'text-slate-500',
  red: 'text-red-500',
  orange: 'text-orange-500',
  amber: 'text-amber-500',
  green: 'text-green-500',
  teal: 'text-teal-500',
  blue: 'text-blue-500',
  violet: 'text-violet-500',
  pink: 'text-pink-500',
};

/** What a note page can be marked with — enough to tell pages apart at a glance. */
export const NOTE_ICONS = [
  '📝', '📌', '💡', '⭐', '🔥', '✅', '🎯', '📅',
  '📦', '🚚', '🏭', '🛒', '🧾', '💰', '📊', '📈',
  '📞', '✉️', '🤝', '👥', '🧑‍💼', '🏢', '🔑', '🛠️',
  '🌺', '🍵', '🌿', '🌶️', '🍫', '☕', '🧂', '🍯',
  '🎉', '🎁', '✈️', '🏖️', '❤️', '🌈', '☀️', '🌙',
  '❓', '⚠️', '🔒', '📚', '🧠', '🧹', '🩺', '🐾',
];
