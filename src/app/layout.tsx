import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { I18nProvider } from '@/i18n';
// Server-callable values must come from the non-client module.
import { LOCALE_COOKIE, resolveLocale } from '@/i18n/config';
import './globals.css';

export const metadata: Metadata = {
  title: 'Operation Manager',
  description: 'Operations task management for the logistics team',
  manifest: '/manifest.webmanifest',
  applicationName: 'Operation Manager',
  appleWebApp: {
    capable: true,
    title: 'Operation Manager',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192' }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0e' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Locked to the device width. This is used one-handed on the warehouse
  // floor, where a stray pinch leaves the layout zoomed and half off-screen
  // with no obvious way back. Fixing the scale also stops iOS Safari zooming
  // in whenever a form field below 16px is focused, which shifted the page
  // under the user's thumb mid-entry.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Language is resolved server-side so the first paint is already translated.
  const locale = resolveLocale(cookies().get(LOCALE_COOKIE)?.value);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function () {
                  navigator.serviceWorker.register('/sw.js').catch(function () {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
