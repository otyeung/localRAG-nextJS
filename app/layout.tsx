import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { siteDescription, siteTitle } from './site-content';

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
