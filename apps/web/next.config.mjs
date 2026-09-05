import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// One .env at the repo root, shared by all three workstreams. Next would
// otherwise only look in apps/web.
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });

/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@rto/core', '@rto/db'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};
