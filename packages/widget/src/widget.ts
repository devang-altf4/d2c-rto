/**
 * widget.js — the whole merchant-facing surface.
 *
 *   <script src="https://…/widget.js" data-shop="kaira" defer></script>
 *
 * Deliberately tiny and dependency-free. Everything heavy — camera, MediaPipe,
 * the model — lives behind an iframe on our origin and downloads only when she
 * taps. A product page must not pay megabytes for a widget most visitors never
 * open.
 *
 * Split of responsibilities:
 *   here     find the product, inject the button, open the iframe, write the
 *            chosen size back into whatever variant picker the theme uses
 *   iframe   camera, measurement, sizing, our CSS, our CSP
 *
 * The fragile part — guessing at someone else's DOM — is kept in these few
 * hundred bytes so it can be special-cased per theme without touching anything
 * that matters.
 */

interface Product {
  styleId: string;
  styleName?: string;
}

(function () {
  const script = document.currentScript as HTMLScriptElement | null;
  const origin = script ? new URL(script.src).origin : window.location.origin;

  const SIZE_SELECTORS = [
    '[name="options[Size]"]',
    '[data-option-name="size" i]',
    'select[name*="size" i]',
    'fieldset[name*="size" i]',
    '.product-form__input--size',
    '[data-rto-size-selector]',
  ];

  function findProduct(): Product | null {
    // 1. Explicit — what our own demo storefront and any real integration use.
    const w = (window as any).__RTO_PRODUCT;
    if (w?.styleId) return w;

    // 2. Script tag attributes.
    const fromAttr = script?.dataset.styleId;
    if (fromAttr) return { styleId: fromAttr };

    // 3. Shopify themes commonly emit product JSON. Take the handle as a last
    //    resort so the button still appears.
    const meta = document.querySelector<HTMLScriptElement>('script[type="application/ld+json"]');
    if (meta) {
      try {
        const ld = JSON.parse(meta.textContent || '{}');
        const sku = ld.sku || ld.productID;
        if (sku) return { styleId: String(sku), styleName: ld.name };
      } catch {
        /* malformed structured data is not our problem */
      }
    }
    return null;
  }

  function findSizeControl(): Element | null {
    for (const sel of SIZE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /**
   * Write the recommendation back into the theme's own control.
   *
   * This is the genuinely messy part across thousands of Shopify themes, so it
   * fails soft: if we cannot find a control to set, the size is still on screen
   * for her to pick herself. Never throw inside a merchant's page.
   */
  function applySize(size: string): boolean {
    const control = findSizeControl();
    if (!control) return false;

    if (control instanceof HTMLSelectElement) {
      const opt = [...control.options].find(
        (o) => o.value.trim().toUpperCase() === size || o.text.trim().toUpperCase() === size,
      );
      if (!opt) return false;
      control.value = opt.value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const candidates = control.querySelectorAll<HTMLElement>('input, label, button, [data-value]');
    for (const el of candidates) {
      const v = (
        (el as HTMLInputElement).value ||
        el.getAttribute('data-value') ||
        el.textContent ||
        ''
      ).trim().toUpperCase();
      if (v !== size) continue;
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ modal

  let overlay: HTMLDivElement | null = null;

  function open(product: Product) {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Find your size');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483000',
      background: 'rgba(10,12,15,.62)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '16px',
    } as CSSStyleDeclaration);

    const frame = document.createElement('iframe');
    frame.src = `${origin}/embed?style=${encodeURIComponent(product.styleId)}`;
    frame.allow = 'camera; fullscreen';
    frame.setAttribute('title', 'Find your size');
    Object.assign(frame.style, {
      width: '100%', maxWidth: '460px', height: 'min(84vh, 760px)',
      border: '0', borderRadius: '10px', background: '#fff',
      boxShadow: '0 24px 70px rgba(0,0,0,.34)',
    } as CSSStyleDeclaration);

    overlay.appendChild(frame);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  function close() {
    overlay?.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey);
  }

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== origin) return;
    const d = e.data;
    if (!d || d.source !== 'rto-fit') return;

    if (d.type === 'apply') {
      const ok = applySize(String(d.size).toUpperCase());
      window.dispatchEvent(
        new CustomEvent('rto:size-applied', { detail: { size: d.size, applied: ok } }),
      );
      close();
    }
    if (d.type === 'close') close();
  });

  // ----------------------------------------------------------------- button

  function inject(product: Product) {
    if (document.querySelector('[data-rto-button]')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.rtoButton = '';
    btn.textContent = 'Find my size';
    Object.assign(btn.style, {
      display: 'inline-flex', alignItems: 'center', gap: '7px',
      font: 'inherit', fontSize: '14px', fontWeight: '600',
      padding: '9px 14px', marginTop: '10px', cursor: 'pointer',
      background: 'transparent', color: 'currentColor',
      border: '1px solid currentColor', borderRadius: '4px',
    } as CSSStyleDeclaration);
    btn.addEventListener('click', () => open(product));

    const anchor = findSizeControl();
    const host = anchor?.parentElement ?? anchor ?? document.querySelector('form[action*="/cart"]');
    if (host) host.appendChild(btn);
    else document.body.appendChild(btn);
  }

  function boot() {
    const product = findProduct();
    if (!product) return; // not a product page — do nothing, quietly
    inject(product);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
