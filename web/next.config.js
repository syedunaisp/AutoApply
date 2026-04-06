/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  transpilePackages: ['@autoapply/types'],
  images: { unoptimized: true },
}

module.exports = nextConfig
