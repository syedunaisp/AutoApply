/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  transpilePackages: ['@autoapply/types'],
  images: { unoptimized: true },
  webpack: (config) => {
    // pdfjs-dist optionally requires 'canvas' for Node.js — not needed in browser
    config.resolve.alias.canvas = false
    config.resolve.alias.encoding = false
    return config
  },
}

module.exports = nextConfig
