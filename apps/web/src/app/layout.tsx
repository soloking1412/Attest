import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Attest',
  description: 'Signed build and audit records for Cardano scripts',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <a className="brand" href="/">
            Attest
          </a>
          <nav>
            <a href="/">Publish</a>
            <a href="/verify">Verify</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
