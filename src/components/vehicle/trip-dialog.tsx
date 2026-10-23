'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { fromLocalInput, toLocalInput } from '@/components/goods-reception/reception-bits';
import { correctTrip, deleteTrip, endTrip, startTrip } from '@/server/vehicle-actions';
import type { VehicleTrip } from '@/server/vehicle';
import { useVehicleError } from './vehicle-bits';

/**
 * One round: going out, coming back, or correcting either.
 *
 * The time starts as now and can be changed — a tap made ten minutes late
 * should say when the van left, not when somebody remembered. The km are the
 * ones on the dashboard.
 */
export function TripDialog({
  mode,
  trip,
  lastKm,
  canDelete = false,
  onClose,
}: {
  mode: 'start' | 'end' | 'edit';
  /** The round being ended or corrected. */
  trip?: VehicleTrip;
  /** What the odometer last showed, offered when going out. */
  lastKm?: number | null;
  canDelete?: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = useVehicleError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const now = toLocalInput(new Date().toISOString());
  const [leftAt, setLeftAt] = useState(trip ? toLocalInput(trip.left_at) : now);
  const [leftKm, setLeftKm] = useState(trip ? String(trip.left_km) : lastKm != null ? String(lastKm) : '');
  const [returnedAt, setReturnedAt] = useState(trip?.returned_at ? toLocalInput(trip.returned_at) : mode === 'end' ? now : '');
  const [returnedKm, setReturnedKm] = useState(trip?.returned_km != null ? String(trip.returned_km) : '');
  const [note, setNote] = useState(trip?.note ?? '');

  const showOut = mode !== 'end';
  const showBack = mode === 'end' || (mode === 'edit' && Boolean(trip?.returned_at));
  const kmOk = (v: string) => v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0;
  const ready =
    (!showOut || (leftAt !== '' && kmOk(leftKm))) &&
    (!showBack || (returnedAt !== '' && kmOk(returnedKm) && Number(returnedKm) >= Number(trip?.left_km ?? leftKm)));

  function done(res: { ok: true } | { ok: false; error: string }) {
    if (!res.ok) return setError(translateError(res.error));
    onClose();
    router.refresh();
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const cleanNote = note.trim() || null;
      if (mode === 'start') return done(await startTrip({ left_at: fromLocalInput(leftAt), left_km: Number(leftKm), note: cleanNote }));
      if (mode === 'end') return done(await endTrip(trip!.id, { returned_at: fromLocalInput(returnedAt), returned_km: Number(returnedKm), note: cleanNote }));
      done(
        await correctTrip(trip!.id, {
          left_at: fromLocalInput(leftAt),
          left_km: Number(leftKm),
          returned_at: showBack ? fromLocalInput(returnedAt) : null,
          returned_km: showBack ? Number(returnedKm) : null,
          note: cleanNote,
        }),
      );
    });
  }

  function remove() {
    if (!trip || !window.confirm(t('palomo.deleteTripConfirm'))) return;
    startTransition(async () => done(await deleteTrip(trip.id)));
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(mode === 'start' ? 'palomo.start' : mode === 'end' ? 'palomo.end' : 'palomo.editTrip')}
      footer={
        <>
          {canDelete && mode === 'edit' && (
            <Button variant="ghost" onClick={remove} disabled={pending} className="mr-auto text-late">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t('common.delete')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} disabled={!ready} onClick={submit}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        {showOut && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('palomo.leftAt')} htmlFor="trip-left-at" required>
              <Input id="trip-left-at" type="datetime-local" value={leftAt} onChange={(e) => setLeftAt(e.target.value)} />
            </Field>
            <Field label={t('palomo.kmOut')} htmlFor="trip-left-km" hint={mode === 'start' && lastKm != null ? t('palomo.lastKm', { km: lastKm }) : undefined} required>
              <Input id="trip-left-km" type="number" inputMode="numeric" min="0" step="1" value={leftKm} onChange={(e) => setLeftKm(e.target.value)} />
            </Field>
          </div>
        )}
        {showBack && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('palomo.returnedAt')} htmlFor="trip-back-at" required>
              <Input id="trip-back-at" type="datetime-local" value={returnedAt} onChange={(e) => setReturnedAt(e.target.value)} />
            </Field>
            <Field
              label={t('palomo.kmBack')}
              htmlFor="trip-back-km"
              hint={trip ? t('palomo.kmOutWas', { km: mode === 'end' ? trip.left_km : leftKm }) : undefined}
              required
            >
              <Input id="trip-back-km" type="number" inputMode="numeric" min={trip?.left_km ?? 0} step="1" value={returnedKm} onChange={(e) => setReturnedKm(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label={t('palomo.note')} hint={t('palomo.noteHint')} htmlFor="trip-note">
          <NoteTextarea id="trip-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
