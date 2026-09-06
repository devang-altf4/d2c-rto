import type { ReactNode } from 'react';
import Link from 'next/link';
import { Marcellus } from 'next/font/google';
import './store.css';

/**
 * Store chrome for everything under /shop.
 *
 * The diagnosis screens keep the app palette; this section gets a retail one.
 * Marcellus is self-hosted by next/font at build time, so the venue wifi is not
 * in the critical path on stage.
 */
const display = Marcellus({
  weight: '400',
  subsets: ['latin'],
  variable: '--store-display',
  display: 'swap',
});

const NAV = ['New in', 'Kurtas', 'Kurta sets', 'Dresses', 'Sale'];

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`store ${display.variable}`}>
      <div className="store-strip">
        Demo store · Kaira is a fictional label, built to exercise the fit layer
      </div>

      <header className="store-head">
        <div className="in">
          <Link href="/shop" className="store-mark">KAIRA</Link>
          <nav className="store-nav">
            {NAV.map((n) => (
              <span key={n} className={n === 'Kurtas' ? 'on' : undefined}>{n}</span>
            ))}
          </nav>
          <div className="store-util">
            <span>Search</span><span>Account</span><span>Bag (0)</span>
          </div>
        </div>
      </header>

      {children}

      <footer className="store-foot">
        <div className="in">
          Kaira is fictional and the catalogue is generated — the styles, prices and photography are
          scaffolding for the fit layer underneath. Lookbook images are licensed from Unsplash; see{' '}
          <code>public/products/README.txt</code>. · <Link href="/">Diagnosis →</Link>
        </div>
      </footer>
    </div>
  );
}
