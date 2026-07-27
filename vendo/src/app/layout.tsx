import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Vendo - Everything your business needs',
  description: 'A unified African commerce platform for online stores, payments, and merchant tools.',
  viewport: 'width=device-width, initial-scale=1',
  robots: 'index, follow',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div id="__next">{children}</div>
      </body>
    </html>
  );
}
