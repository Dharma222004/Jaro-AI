import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jaro AI — AI-Powered Stock Research',
  description:
    'Research Indian stocks using AI-powered analysis, current web information, financial documents, and structured research reports.',
  keywords: ['stock research', 'Indian stocks', 'NSE', 'BSE', 'equity research', 'AI finance'],
  authors: [{ name: 'Jaro AI' }],
  robots: 'noindex, nofollow', // Private tool
  icons: {
    icon: [
      { url: '/logo.png', type: 'image/png', sizes: '32x32' },
      { url: '/logo.png', type: 'image/png', sizes: '16x16' },
    ],
    apple: [{ url: '/logo.png', sizes: '180x180' }],
    shortcut: '/logo.png',
  },
  openGraph: {
    title: 'Jaro AI — AI-Powered Stock Research',
    description: 'Research Indian stocks using AI-powered analysis.',
    images: [{ url: '/logo.png' }],
  },
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
