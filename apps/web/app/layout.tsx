import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rush',
  description: 'Enterprise AI Agent Infrastructure',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        {children}
      </body>
    </html>
  );
}
