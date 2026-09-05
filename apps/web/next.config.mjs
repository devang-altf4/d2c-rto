/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@rto/core', '@rto/db'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};
