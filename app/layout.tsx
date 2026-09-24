import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://jaro-ai.vercel.app'),
  title: 'Jaro AI — AI-Powered Stock Research',
  description:
    'Research Indian stocks using AI-powered analysis, current web information, financial documents, and structured research reports.',
  keywords: ['stock research', 'Indian stocks', 'NSE', 'BSE', 'equity research', 'AI finance'],
  authors: [{ name: 'Jaro AI' }],
  robots: 'noindex, nofollow',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    title: 'Jaro AI — AI-Powered Stock Research',
    description: 'Research Indian stocks using AI-powered analysis.',
    images: [{ url: '/logo.png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#050505' },
    { media: '(prefers-color-scheme: light)', color: '#F4F4F5' },
  ],
};


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
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
