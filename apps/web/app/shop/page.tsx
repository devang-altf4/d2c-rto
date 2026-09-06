import Link from 'next/link';
import { featuredStyles } from './catalogue';
import { cropPosition, productCard } from './lookbook';

/**
 * Catalogue index.
 *
 * Ordered by learned offset, so the styles where the published chart and the
 * exchange record disagree sit at the top. That ordering is the whole argument
 * of the product, made without a word of copy — the first row is where M has
 * quietly become L.
 */
export default function ShopIndex() {
  const styles = featuredStyles();

  return (
    <main className="store-main">
      <div className="store-hero">
        <h1>Kurtas &amp; kurta sets</h1>
        <p>
          Everyday ethnic wear in cotton, chanderi, khadi and muslin. Styles carrying a size
          correction are listed first — those are the ones where the chart and the returns disagree.
        </p>
      </div>

      <div className="store-grid">
        {styles.map((s) => {
          const price = Math.round(s.mrpPaise / 100);
          // Only badge a correction big enough to move a size. 2cm is roughly
          // one grade on this ladder; badging every positive offset put a flag
          // on almost every tile, which reads as decoration rather than signal.
          const material = s.learnedOffsetCm >= 2;
          return (
            <Link key={s.styleId} href={`/shop/${s.styleId}`} className="tile">
              <div className="shot">
                <img
                  src={productCard(s.styleId)}
                  alt={s.styleName}
                  loading="lazy"
                  style={{ objectPosition: cropPosition(s.styleId) }}
                />
                {material && (
                  <span className="tag">Runs small · +{s.learnedOffsetCm.toFixed(1)}cm</span>
                )}
              </div>
              <div className="nm">{s.styleName}</div>
              <div className="pr store-num">₹{price.toLocaleString('en-IN')}</div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
