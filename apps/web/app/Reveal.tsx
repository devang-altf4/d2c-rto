'use client';

import { useState } from 'react';

/**
 * Act 1. Two views of the same ₹67.7L.
 *
 * The reveal is not a new chart — it is the AXIS CHANGING. First the money is
 * cut the way the courier codes it, which cannot name size. Then it is re-cut
 * the way the brand's own exchange records explain it, and a slice appears
 * that was never visible in the first view.
 *
 * Spend the polish here. This transition is the pitch.
 */

interface CourierRow { code: string; count: number; rupees: number }
interface StyleRow {
  styleId: string;
  styleName: string;
  rtoCount: number;
  sizeExchangeRate: number;
  adjustedRupees: number;
  learnedOffsetCm: number;
  actuallyRunsSmall: boolean;
}

const lakh = (r: number) => `₹${(r / 100000).toFixed(1)}L`;

export function Reveal({
  courier, totalRtoRupees, floorRupees, adjustedRupees, propensity, recall, styles,
}: {
  courier: CourierRow[];
  totalRtoRupees: number;
  floorRupees: number;
  adjustedRupees: number;
  propensity: number;
  recall: number;
  styles: StyleRow[];
}) {
  const [revealed, setRevealed] = useState(false);
  const max = Math.max(...courier.map((c) => c.rupees));
  const sizePct = (adjustedRupees / totalRtoRupees) * 100;

  return (
    <>
      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--rule)',
          padding: '22px 24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 18,
            paddingBottom: 14,
            borderBottom: '1px solid var(--rule-soft)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>
            {revealed ? 'What your exchange records explain' : 'What your courier tells you'}
          </h2>
          <button
            onClick={() => setRevealed((v) => !v)}
            style={{
              font: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '7px 14px',
              borderRadius: 3,
              border: '1px solid var(--accent)',
              background: revealed ? 'transparent' : 'var(--accent)',
              color: revealed ? 'var(--accent)' : '#fff',
            }}
          >
            {revealed ? 'Back to the courier view' : 'Overlay exchange data'}
          </button>
        </div>

        {!revealed ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {courier.slice(0, 8).map((c) => (
                <div
                  key={c.code}
                  style={{ display: 'grid', gridTemplateColumns: '190px 1fr 86px', gap: 14, alignItems: 'center' }}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>
                    {c.code}
                  </span>
                  <div style={{ height: 20, background: 'var(--surface-2)', borderRadius: 2 }}>
                    <div
                      style={{
                        width: `${(c.rupees / max) * 100}%`,
                        height: '100%',
                        background: 'var(--rule)',
                        borderRadius: 2,
                        transition: 'width .5s ease',
                      }}
                    />
                  </div>
                  <span className="num" style={{ fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right' }}>
                    {lakh(c.rupees)}
                  </span>
                </div>
              ))}
            </div>
            <p style={{ margin: '18px 0 0', fontSize: 14, color: 'var(--muted)', maxWidth: '62ch' }}>
              Eighteen reason codes, and not one of them can say <em>ran small</em>. A size failure
              reaches you as <code style={{ fontFamily: 'var(--mono)' }}>REFUSED_COD</code> — filed
              under customer remorse, owner listed as checkout, marked rarely savable.
            </p>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', height: 46, borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
              <div
                style={{
                  width: `${sizePct}%`,
                  background: 'var(--accent)',
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: 'var(--mono)',
                  fontSize: 13,
                  fontWeight: 600,
                  transition: 'width .6s cubic-bezier(.2,.7,.3,1)',
                }}
              >
                {lakh(adjustedRupees)}
              </div>
              <div
                style={{
                  flex: 1,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--rule-soft)',
                  borderLeft: 'none',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: 'var(--mono)',
                  fontSize: 13,
                  color: 'var(--muted)',
                }}
              >
                {lakh(totalRtoRupees - adjustedRupees)} everything else
              </div>
            </div>

            <p style={{ margin: '0 0 6px', fontSize: 15, maxWidth: '64ch' }}>
              <strong>{lakh(adjustedRupees)} of it is size failure</strong> — {sizePct.toFixed(0)}% of
              your RTO cost, recovered from returns you already have, on orders the courier filed as
              remorse.
            </p>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', maxWidth: '66ch' }}>
              Exchange records alone give a floor of {lakh(floorRupees)}. Most shoppers who get the
              wrong size never raise an exchange, so we adjust for a propensity of about{' '}
              {Math.round(propensity * 100)}% — deliberately conservative. Against this synthetic
              corpus, where the true answer is known, the estimate lands{' '}
              <strong>under</strong> it, and ranking by this signal recovers{' '}
              <strong>{Math.round(recall * 100)}%</strong> of the styles we injected with a bad size
              chart.
            </p>
          </>
        )}
      </section>

      {revealed && (
        <section style={{ marginTop: 28 }}>
          <h3 style={{ fontSize: 13, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 4px' }}>
            Where to fix it
          </h3>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--muted)', paddingBottom: 12, borderBottom: '1px solid var(--rule)' }}>
            Twelve styles carrying the most size-attributed cost. The offset is what the widget
            applies at the product page.
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  <th style={{ padding: '8px 10px 8px 0', fontWeight: 500 }}>Style</th>
                  <th style={{ padding: '8px 10px', fontWeight: 500, textAlign: 'right' }}>RTO</th>
                  <th style={{ padding: '8px 10px', fontWeight: 500, textAlign: 'right' }}>Size exch.</th>
                  <th style={{ padding: '8px 10px', fontWeight: 500, textAlign: 'right' }}>Cost</th>
                  <th style={{ padding: '8px 0 8px 10px', fontWeight: 500, textAlign: 'right' }}>Offset</th>
                </tr>
              </thead>
              <tbody>
                {styles.map((s) => (
                  <tr key={s.styleId} style={{ borderTop: '1px solid var(--rule-soft)' }}>
                    <td style={{ padding: '9px 10px 9px 0' }}>
                      {s.styleName}
                      {s.actuallyRunsSmall && (
                        <span
                          title="Injected in the synthetic corpus — shown to validate the estimator, never used as an input to it"
                          style={{
                            marginLeft: 8, fontFamily: 'var(--mono)', fontSize: 10,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                            color: 'var(--warn)', border: '1px solid var(--warn)',
                            borderRadius: 2, padding: '1px 5px',
                          }}
                        >
                          truly small
                        </span>
                      )}
                    </td>
                    <td className="num" style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13 }}>{s.rtoCount}</td>
                    <td className="num" style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13 }}>{(s.sizeExchangeRate * 100).toFixed(1)}%</td>
                    <td className="num" style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13 }}>₹{Math.round(s.adjustedRupees / 1000)}k</td>
                    <td className="num" style={{ padding: '9px 0 9px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13, color: s.learnedOffsetCm > 0 ? 'var(--accent)' : 'var(--muted)' }}>
                      {s.learnedOffsetCm > 0 ? `−${s.learnedOffsetCm.toFixed(1)}cm` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--muted)', maxWidth: '66ch' }}>
            <strong style={{ color: 'var(--warn)' }}>Truly small</strong> is ground truth from the
            generator, shown only to validate the estimate. The model never sees it.
          </p>
        </section>
      )}
    </>
  );
}
