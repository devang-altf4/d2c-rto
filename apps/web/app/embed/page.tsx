import { PoseCapture } from './PoseCapture';

/**
 * The iframe the widget opens. Same origin as the app, isolated from whatever
 * CSS the merchant's Shopify theme is running. Needs allow="camera" on the
 * parent iframe tag.
 */
export default function EmbedPage() {
  return (
    <main style={{ padding: 18, minHeight: '100dvh', background: 'var(--ground)' }}>
      <PoseCapture garmentLengthCm={112} />
    </main>
  );
}
