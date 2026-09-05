import { Embed } from './Embed';

/**
 * The iframe the widget opens. Same origin as the app, isolated from whatever
 * CSS the merchant's theme is running. The parent sets allow="camera".
 */
export default async function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<{ style?: string }>;
}) {
  const { style } = await searchParams;
  return (
    <main style={{ minHeight: '100dvh', background: 'var(--ground)' }}>
      <Embed styleId={style ?? 'KAI-001'} />
    </main>
  );
}
