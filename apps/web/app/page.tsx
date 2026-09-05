import diagnosis from '../../../data/diagnosis.json';
import { Reveal } from './Reveal';

export default function Page() {
  const d = diagnosis as any;

  return (
    <main className="wrap">
      <header style={{ borderBottom: '2px solid var(--ink)', paddingBottom: 18, marginBottom: 30 }}>
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            display: 'flex',
            gap: 18,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <span>Kaira · womenswear</span>
          <span>12 months to Sep 2026</span>
          <span>synthetic data</span>
        </div>
        <h1
          style={{
            margin: '0 0 8px',
            fontSize: 'clamp(28px, 5vw, 40px)',
            lineHeight: 1.05,
            letterSpacing: '-0.025em',
            textWrap: 'balance',
          }}
        >
          Where the RTO actually comes from
        </h1>
        <p style={{ margin: 0, color: 'var(--ink-2)', maxWidth: '58ch' }}>
          {d.totalRto.toLocaleString('en-IN')} of {d.totalOrders.toLocaleString('en-IN')} orders came
          back before anyone opened them. That is{' '}
          <strong>₹{(d.totalRtoRupees / 100000).toFixed(1)} lakh</strong> of cost of goods and
          two-way freight, in a year.
        </p>
      </header>

      <Reveal
        courier={d.courierBreakdown}
        totalRtoRupees={d.totalRtoRupees}
        floorRupees={d.attributedSizeRupees}
        adjustedRupees={d.adjustedSizeRupees}
        propensity={d.assumedExchangePropensity}
        recall={d.recall}
        styles={d.styles.slice(0, 12)}
      />
    </main>
  );
}
