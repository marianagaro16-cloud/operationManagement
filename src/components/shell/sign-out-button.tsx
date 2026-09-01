'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';

export function SignOutButton({ full = false }: { full?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={loading}
      className={full ? 'w-full justify-start' : undefined}
      onClick={async () => {
        setLoading(true);
        await createClient().auth.signOut();
        router.push('/login');
        router.refresh();
      }}
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden />
      {t('auth.signOut')}
    </Button>
  );
}
