'use client';

import { useState, useTransition } from 'react';
import { useI18n } from '@/i18n';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/primitives';
import { blockOccurrence } from '@/server/actions';

/**
 * Blocking always requires a reason, for the same reason skipping does: a
 * blocker nobody described is indistinguishable from neglect when someone
 * reads the list tomorrow.
 *
 * The wording is deliberately about the WORK, not the person — this exists so
 * an operator is not recorded as late for something that was never theirs to
 * control, and the dialog should say so.
 */
export function BlockDialog({
  open,
  onClose,
  occurrenceId,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  occurrenceId: string;
  onError: (code: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [touched, setTouched] = useState(false);

  const empty = reason.trim().length === 0;

  function submit() {
    setTouched(true);
    if (empty) return;
    startTransition(async () => {
      const res = await blockOccurrence(occurrenceId, reason);
      if (!res.ok) onError(res.error);
      setReason('');
      setTouched(false);
      onClose();
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('task.blockTitle')}
      description={t('task.blockBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={empty}>
            {t('task.blockConfirm')}
          </Button>
        </>
      }
    >
      <Field
        label={t('task.blockReason')}
        required
        htmlFor="block-reason"
        error={touched && empty ? t('task.blockReasonRequired') : undefined}
      >
        <Textarea
          id="block-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={t('task.blockReasonPlaceholder')}
          autoFocus
        />
      </Field>
    </Dialog>
  );
}
