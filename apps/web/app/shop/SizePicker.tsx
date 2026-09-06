'use client';

import { useState } from 'react';

/**
 * Size chips, not a dropdown — a real listing uses chips, and widget.js already
 * supports either (it looks inside .product-form__input--size for anything with
 * a matching data-value and clicks it).
 *
 * THE WRAPPER CLASS IS THE INTEGRATION CONTRACT. widget.js finds its anchor by
 * `.product-form__input--size` and hangs its button off the parent. Renaming it
 * silently breaks the embed, so it is spelled out here rather than left to a
 * stylesheet.
 *
 * A click dispatched by the widget arrives with isTrusted false, which is how a
 * recommendation is told apart from the shopper picking a size herself. That is
 * the difference the RTO signal is built on, so it is worth capturing here at
 * the source rather than inferring it later.
 *
 * The chips get their own wrapper because widget.js hangs its button off the
 * anchor's PARENT. Wrap the chips and the Add to bag button together and the
 * injected button lands underneath the CTA instead of beside the sizes.
 */
export function SizePicker({ sizes }: { sizes: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [recommended, setRecommended] = useState<string | null>(null);

  function choose(size: string, fromWidget: boolean) {
    setSelected(size);
    if (fromWidget) setRecommended(size);
  }

  const overridden = recommended !== null && selected !== null && selected !== recommended;

  return (
    <>
      <div>
        <div className="product-form__input--size sizes">
          {sizes.map((s) => (
            <button
              key={s}
              type="button"
              className="sz"
              data-value={s}
              data-rec={recommended === s ? '1' : undefined}
              aria-pressed={selected === s}
              onClick={(e) => choose(s, !e.isTrusted)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {overridden && (
        <p style={{ fontSize: 13, color: 'var(--stop)' }}>
          We measured <b>{recommended}</b> and you have picked <b>{selected}</b>. That override is
          the strongest single predictor that this order comes back.
        </p>
      )}

      <button className="addbag" type="button" disabled={!selected}>
        {selected ? `Add to bag · ${selected}` : 'Select a size'}
      </button>
    </>
  );
}
