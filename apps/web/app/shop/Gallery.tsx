'use client';

import { useState } from 'react';

/** Thumb strip plus main frame. Client-side only so the PDP itself stays static. */
export function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  return (
    <div className="gal">
      <div className="gal-thumbs">
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            aria-pressed={i === active}
            aria-label={`${alt}, view ${i + 1}`}
            onClick={() => setActive(i)}
          >
            <img src={src} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <div className="gal-main">
        <img src={images[active]} alt={alt} />
      </div>
    </div>
  );
}
