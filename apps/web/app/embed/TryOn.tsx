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
 *
 * When the camera path was used we already hold the frame she was measured in,
 * so this renders straight from it. Asking someone to go and find a full-length
 * photo of herself, mid-checkout, loses most of them — and the captured frame
 * is a better input anyway, because it is the pose the size came from.
 */

type State = 'idle' | 'working' | 'done' | 'error';

const MAX_BYTES = 4 * 1024 * 1024;

export function TryOn({
  styleId,
  size,
  capturedFrame,
}: {
  styleId: string;
  size: string;
  /** Data URL of the frame from PoseCapture, when the camera path was used. */
  capturedFrame?: string;
}) {
  const [state, setState] = useState<State>('idle');
  const [image, setImage] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function render(personImage: string) {
    setState('working');
    setError(null);
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

  async function onPick(file: File) {
    if (file.size > MAX_BYTES) {
      setError('That photo is over 4MB — try a smaller one.');
      setState('error');
      return;
    }

    const personImage = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('could not read that file'));
      r.readAsDataURL(file);
    });
    await render(personImage);
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
        onClick={() => (capturedFrame ? render(capturedFrame) : input.current?.click())}
        disabled={state === 'working'}
        style={{ ...secondary, opacity: state === 'working' ? 0.6 : 1 }}
      >
        {state === 'working'
          ? 'Generating preview…'
          : capturedFrame
            ? `Render it on me in ${size}`
            : `See it on you in ${size}`}
      </button>

      {capturedFrame && state !== 'working' && (
        <button onClick={() => input.current?.click()} style={link}>
          Use a different photo
        </button>
      )}

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
          Optional. {capturedFrame ? 'The frame you were measured in is' : 'Your photo is'} sent to
          our server for this step only — the measurement itself never left your device.
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
