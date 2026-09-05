import Link from 'next/link';
import skus from '../../../../data/skus.json';

/** Styles with a learned offset come first — those are where M becomes L. */
export default function ShopIndex() {
  const seen = new Map<string, any>();
  for (const s of skus as any[]) if (!seen.has(s.styleId)) seen.set(s.styleId, s);
  const styles = [...seen.values()]
    .sort((a, b) => b.learnedOffsetCm - a.learnedOffsetCm)
    .slice(0, 24);

  return (
    <main className="wrap">
      <h1 style={{ fontSize: 26, letterSpacing: '-0.02em', margin: '0 0 4px' }}>Kaira</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 26px', fontSize: 14 }}>
        Styles carrying a correction are listed first — those are the ones where the chart and the
        returns disagree.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 18 }}>
        {styles.map((s) => (
          <Link
            key={s.styleId}
            href={`/shop/${s.styleId}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div
              style={{
                aspectRatio: '3 / 4', borderRadius: 5, border: '1px solid var(--rule)',
                background: 'linear-gradient(150deg, var(--surface-2), var(--accent-soft))',
                display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 12,
              }}
            >
              {s.styleId}
            </div>
            <div style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.35 }}>{s.styleName}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              ₹{Math.round(s.mrpPaise / 100).toLocaleString('en-IN')}
              {s.learnedOffsetCm > 0 && (
                <span style={{ color: 'var(--accent)', marginLeft: 8, fontFamily: 'var(--mono)', fontSize: 11 }}>
                  −{s.learnedOffsetCm.toFixed(1)}cm
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
