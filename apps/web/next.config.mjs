/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@ratatube/shared',
    '@ratatube/subtitle-engine',
    '@ratatube/addon-sdk',
    '@ratatube/database',
    '@ratatube/local-agent'
  ],
  images: {
    unoptimized: true
  }
};

export default nextConfig;

