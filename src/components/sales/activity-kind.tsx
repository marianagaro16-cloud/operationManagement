'use client';

import { Calendar, Circle, FileText, Mail, MapPin, MessageCircle, Phone, Star, Tag } from 'lucide-react';
import { useI18n } from '@/i18n';
import { localizedName } from '@/lib/localized-content';
import { cn } from '@/lib/utils';
import type { ActivityKind, KindIcon as KindIconName } from '@/types/sales';

/* A kind of sales activity, as it reads: its icon and its name in the reader's language. */

const ICONS: Record<KindIconName, typeof Phone> = {
  phone: Phone,
  calendar: Calendar,
  mail: Mail,
  'map-pin': MapPin,
  'message-circle': MessageCircle,
  tag: Tag,
  star: Star,
  'file-text': FileText,
  circle: Circle,
};

export function KindIcon({ icon, className }: { icon: KindIconName; className?: string }) {
  const Icon = ICONS[icon] ?? Circle;
  return <Icon className={cn('h-3.5 w-3.5', className)} aria-hidden />;
}

export function useKinds(kinds: ActivityKind[]) {
  const { locale } = useI18n();
  const byId = new Map(kinds.map((k) => [k.id, k]));
  return {
    get: (id: string) => byId.get(id),
    name: (id: string) => {
      const k = byId.get(id);
      return k ? localizedName(k, locale) : '—';
    },
    /** Offered in a form: the active ones, plus the one already chosen. */
    choices: (current?: string | null) => kinds.filter((k) => k.is_active || k.id === current),
  };
}

/** The kind as a small label with its icon. */
export function KindBadge({ kind }: { kind: ActivityKind | undefined }) {
  const { locale } = useI18n();
  if (!kind) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-2xs font-medium text-accent">
      <KindIcon icon={kind.icon} className="h-3 w-3" />
      {localizedName(kind, locale)}
    </span>
  );
}
