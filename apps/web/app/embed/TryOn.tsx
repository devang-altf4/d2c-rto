'use client';

import { useRef, useState } from 'react';

/**
 * Optional preview step, after the size has already been decided.
 *
 * Deliberately AFTER, never instead of. Try-on answers "does it look good";
 * sizing answers "does it fit", and only one of those shows up in the RTO
 * number. If this step is cut for time, the product still works.
 *
 * The image goes to a server, unlike measurement — so the copy scopes the
 * privacy claim honestly rather than dropping it.
 */

type State = 'idle' | 'working' | 'done' | 'error';

const MAX_BYTES = 4 * 1024 * 1024;

export function TryOn({ styleId, size }: { styleId: string; size: string }) {
  const [state, setState] = useState<State>('idle');
  const [image, setImage] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function onPick(file: File) {
    if (file.size > MAX_BYTES) {
      setError('That photo is over 4MB — try a smaller one.');
      setState('error');
      return;
    }

    setState('working');
    setError(null);

    const personImage = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('could not read that file'));
      r.readAsDataURL(file);
    });

    try {
      const res = await fetch('/api/tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personImage, styleId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'preview failed');
      setImage(json.image);
      setCached(Boolean(json.cached));
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'preview failed');
      setState('error');
    }
  }

  if (state === 'done' && image) {
    return (
      <div style={{ marginTop: 18 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt={`Preview of size ${size}`}
          style={{ width: '100%', borderRadius: 6, display: 'block', border: '1px solid var(--rule)' }}
        />
        <p style={note}>
          <strong>Preview only.</strong> Generated from your photo — colour and detail are
          approximate, and the fit shown is size {size}.{cached ? ' Served from cache.' : ''}
        </p>
        <button onClick={() => { setState('idle'); setImage(null); }} style={link}>
          Try a different photo
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--rule-soft)' }}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
      <button
        onClick={() => input.current?.click()}
        disabled={state === 'working'}
        style={{ ...secondary, opacity: state === 'working' ? 0.6 : 1 }}
      >
        {state === 'working' ? 'Generating preview…' : `See it on you in ${size}`}
      </button>

      {state === 'working' && (
        <p style={note}>This takes about twenty seconds the first time.</p>
      )}
      {state === 'error' && (
        <p style={{ ...note, color: 'var(--bad)' }}>
          {error} You can still order — your size is {size}.
        </p>
      )}
      {state === 'idle' && (
        <p style={note}>
          Optional. Your photo is sent to our server for this step only — the measurement
          earlier never left your device.
        </p>
      )}
    </div>
  );
}

const note: React.CSSProperties = {
  margin: '10px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5,
};
const secondary: React.CSSProperties = {
  width: '100%', padding: '12px 16px', font: 'inherit', fontWeight: 600,
  background: 'transparent', color: 'var(--ink)', border: '1px solid var(--rule)',
  borderRadius: 4, cursor: 'pointer',
};
const link: React.CSSProperties = {
  width: '100%', marginTop: 8, padding: 8, font: 'inherit', fontSize: 13,
  background: 'none', border: 'none', color: 'var(--muted)',
  textDecoration: 'underline', cursor: 'pointer',
};
