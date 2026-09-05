import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kaira — fit accuracy',
  description: 'Where the RTO actually comes from.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
