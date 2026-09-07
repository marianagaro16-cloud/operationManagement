import { AuthForm } from '@/components/auth/auth-form';
import { safeRedirectPath } from '@/lib/utils';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  // The middleware parks the original destination here when it bounces an
  // unauthenticated request, so a deep link survives signing in.
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <AuthForm mode="signin" next={safeRedirectPath(searchParams.next)} />
    </main>
  );
}
