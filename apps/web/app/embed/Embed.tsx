'use client';

import { useEffect, useState } from 'react';
import {
  measureFromCrossBrand, recommend,
  type BodyMeasurement, type FitRecommendation, type GarmentSpec, type Size,
} from '@rto/core';
import { PoseCapture } from './PoseCapture';
import { TryOn } from './TryOn';
import brandSizes from '../../../../data/brand-sizes.json';

/**
 * Orchestrates L1 inside the iframe.
 *
 * Two input paths converge on one BodyMeasurement, so recommend() never knows
 * or cares which was used. The cross-brand path exists because the camera can
 * fail — bad light, no permission, a browser that refuses — and a sizing
 * widget that dead-ends in those cases is worse than no widget.
 */

type Path = 'choose' | 'camera' | 'crossbrand' | 'done';

export function Embed({ styleId }: { styleId: string }) {
  const [specs, setSpecs] = useState<GarmentSpec[] | null>(null);
  const [styleName, setStyleName] = useState('');
  const [lengthCm, setLengthCm] = useState(112);
  const [path, setPath] = useState<Path>('choose');
  const [reco, setReco] = useState<FitRecommendation | null>(null);
  // The frame she was measured in, kept so the render step never has to ask
  // her to go and find a photo of herself. Undefined on the cross-brand path.
  const [frame, setFrame] = useState<string | undefined>();

  useEffect(() => {
    fetch(`/api/style/${styleId}`)
      .then((r) => r.json())
      .then((d) => {
        setSpecs(d.specs);
        setStyleName(d.styleName);
        setLengthCm(d.lengthCm);
      })
      .catch(() => setSpecs([]));
  }, [styleId]);

  function finish(body: BodyMeasurement) {
    if (!specs?.length) return;
    const r = recommend(body, specs);
    setReco(r);
    setPath('done');
    post({ type: 'result', recommendation: r, source: body.source });
  }

  if (!specs) return <Shell><p style={muted}>Loading sizes…</p></Shell>;

  if (path === 'done' && reco)
    return (
      <Result reco={reco} styleName={styleName} styleId={styleId} capturedFrame={frame} />
    );

  if (path === 'camera') {
    return (
      <Shell>
        <PoseCapture
          garmentLengthCm={lengthCm}
          onResult={(r) => {
            setFrame(r.frame);
            finish({
              source: 'CAMERA',
              heightCm: r.heightCm,
              bodyChestCm: r.bodyChestCm,
              shoulderCm: r.shoulderCm,
              bandCm: r.bandCm,
              confidence: r.confidence,
            });
          }}
        />
        <button onClick={() => setPath('crossbrand')} style={link}>
          Camera not working? Use your size in another brand
        </button>
      </Shell>
    );
  }

  if (path === 'crossbrand') return <CrossBrand onDone={finish} />;

  return (
    <Shell>
      <h2 style={h2}>Find your size</h2>
      <p style={muted}>
        {styleName ? `For the ${styleName}. ` : ''}Takes about twenty seconds.
      </p>
      <button onClick={() => setPath('camera')} style={primary}>Use my camera</button>
      <button onClick={() => setPath('crossbrand')} style={secondary}>
        I know my size in another brand
      </button>
      <p style={{ ...muted, marginTop: 16, fontSize: 12.5 }}>
        Measurement runs entirely on your device — nothing is uploaded.
      </p>
    </Shell>
  );
}

// -------------------------------------------------- the path that cannot fail

function CrossBrand({ onDone }: { onDone: (b: BodyMeasurement) => void }) {
  const brands = Object.keys(brandSizes) as (keyof typeof brandSizes)[];
  const [brand, setBrand] = useState(brands[0]);
  const [size, setSize] = useState<Size>('M');

  return (
    <Shell>
      <h2 style={h2}>What do you usually wear?</h2>
      <p style={muted}>
        We reconcile the two brands&apos; actual garment measurements — no camera needed.
      </p>
      <div style={{ display: 'grid', gap: 10, margin: '18px 0' }}>
        <select value={brand} onChange={(e) => setBrand(e.target.value as any)} style={field}>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={size} onChange={(e) => setSize(e.target.value as Size)} style={field}>
          {(['XS', 'S', 'M', 'L', 'XL'] as Size[]).map((s) => (
            <option key={s} value={s}>Size {s}</option>
          ))}
        </select>
      </div>
      <button
        onClick={() => onDone(measureFromCrossBrand((brandSizes as any)[brand][size]))}
        style={primary}
      >
        Get my size
      </button>
    </Shell>
  );
}

// --------------------------------------------------------------- the payoff

function Result({
  reco, styleName, styleId, capturedFrame,
}: {
  reco: FitRecommendation;
  styleName: string;
  styleId: string;
  capturedFrame?: string;
}) {
  return (
    <Shell>
      <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
        <div style={muted}>Your size in the {styleName}</div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.03em' }}>
          {reco.recommendedSize}
        </div>
      </div>

      {reco.correctionApplied && (
        <div
          style={{
            marginTop: 14, padding: '12px 14px', borderRadius: 5,
            background: 'var(--accent-soft)', border: '1px solid var(--accent)',
          }}
        >
          <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            The size chart for this style says{' '}
            <strong style={{ textDecoration: 'line-through', opacity: 0.65 }}>
              {reco.naiveSize}
            </strong>
            . Customers who bought it kept telling us otherwise, so we corrected it by{' '}
            <strong>{reco.learnedOffsetCm.toFixed(1)}cm</strong>.
          </div>
        </div>
      )}

      <p style={{ ...muted, marginTop: 14 }}>{reco.reason}</p>
      <p style={{ ...muted, fontSize: 12.5, marginTop: 8 }}>
        Chest {reco.bodyChestCm.toFixed(0)}cm · confidence {Math.round(reco.confidence * 100)}%
        {reco.alternativeSize ? ` · ${reco.alternativeSize} is within the margin` : ''}
      </p>

      <button onClick={() => post({ type: 'apply', size: reco.recommendedSize })} style={primary}>
        Use size {reco.recommendedSize}
      </button>
      <button onClick={() => post({ type: 'close' })} style={link}>Close</button>

      <TryOn styleId={styleId} size={reco.recommendedSize} capturedFrame={capturedFrame} />
    </Shell>
  );
}

// ------------------------------------------------------------------ plumbing

function post(msg: Record<string, unknown>) {
  window.parent?.postMessage({ source: 'rto-fit', ...msg }, '*');
}

function Shell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const send = () =>
      post({ type: 'resize', height: document.documentElement.scrollHeight });
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  });

  return <div style={{ padding: 18, maxWidth: 440, margin: '0 auto' }}>{children}</div>;
}

const h2: React.CSSProperties = { margin: '0 0 6px', fontSize: 20, letterSpacing: '-0.015em' };
const muted: React.CSSProperties = { margin: 0, color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.5 };
const field: React.CSSProperties = {
  font: 'inherit', padding: '11px 12px', borderRadius: 4,
  border: '1px solid var(--rule)', background: 'var(--surface)', color: 'var(--ink)',
};
const primary: React.CSSProperties = {
  width: '100%', marginTop: 16, padding: '13px 16px', font: 'inherit', fontWeight: 600,
  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
};
const secondary: React.CSSProperties = {
  ...primary, background: 'transparent', color: 'var(--ink)',
  border: '1px solid var(--rule)', marginTop: 9,
};
const link: React.CSSProperties = {
  width: '100%', marginTop: 12, padding: 8, font: 'inherit', fontSize: 13,
  background: 'none', border: 'none', color: 'var(--muted)',
  textDecoration: 'underline', cursor: 'pointer',
};
