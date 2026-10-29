import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'CoverPilot | NexaSure proposal assistant',
  description: 'Voice co-browsing assistant for the NexaSure Flexi Shield proposal (NexaSure is a fictional AI-first digital insurance company), built on the Meta Model API.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="min-h-full flex flex-col antialiased selection:bg-purple-200 selection:text-purple-950">
        {children}
      </body>
    </html>
  );
}
