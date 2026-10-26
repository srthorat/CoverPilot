import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OmniBrowse | Autonomous Multimodal Co-Browsing Agent (Meta Hackathon 2026)',
  description: 'Frontier AI browser navigation powered by Meta Muse Spark 1.3, SAM 3.1 & Meta Model API. Track 1: Indie Developer Track.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className="min-h-full flex flex-col antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        {children}
      </body>
    </html>
  );
}
