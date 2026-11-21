import type { Metadata, Viewport } from 'next';
import { Varela_Round, Geist_Mono } from 'next/font/google';
import './globals.css';

const varelaRound = Varela_Round({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-varela-round',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://jaro-ai.vercel.app'),
  title: 'Jaro AI — Institutional Equity Research & Financial Intelligence',
  description:
    'Institutional Indian equity research platform powered by AI. Real-time market data, valuation models, fundamental teardowns, and systematic decision frameworks.',
  keywords: ['stock research', 'Indian stocks', 'NSE', 'BSE', 'equity research', 'AI finance', 'institutional research'],
  authors: [{ name: 'Jaro AI' }],
  robots: 'noindex, nofollow',
  icons: {
    icon: '/jaro-institutional-logo-128.png',
    shortcut: '/jaro-institutional-logo-128.png',
    apple: '/jaro-institutional-logo-128.png',
  },
  openGraph: {
    title: 'Jaro AI — Institutional Equity Research & Financial Intelligence',
    description: 'Institutional Indian equity research platform powered by AI.',
    images: [{ url: '/jaro-institutional-logo.png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#080B12' },
    { media: '(prefers-color-scheme: light)', color: '#F5F7FA' },
  ],
};


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" className={`${varelaRound.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('jaro_theme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=s||(p?'dark':'light');document.documentElement.setAttribute('data-theme',t);if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.classList.remove('light');}else{document.documentElement.classList.add('light');document.documentElement.classList.remove('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
