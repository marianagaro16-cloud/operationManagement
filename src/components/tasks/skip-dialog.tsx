'use client';

import { useState, useTransition } from 'react';
import { useI18n } from '@/i18n';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/primitives';
import { skipOccurrence } from '@/server/actions';

/**
 * Skipping always requires a reason. The submit button stays disabled until
 * one is typed, and the database rejects a reasonless skip regardless — the
 * UI is a convenience, not the rule.
 */
export function SkipDialog({
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
      const res = await skipOccurrence(occurrenceId, reason);
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
      title={t('task.skipTitle')}
      description={t('task.skipBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={empty}>
            {t('task.skipConfirm')}
          </Button>
        </>
      }
    >
      <Field
        label={t('task.skipReason')}
        required
        htmlFor="skip-reason"
        error={touched && empty ? t('task.skipReasonRequired') : undefined}
      >
        <Textarea
          id="skip-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={t('task.skipReasonPlaceholder')}
          autoFocus
        />
      </Field>
    </Dialog>
  );
}
