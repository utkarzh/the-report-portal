/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // @react-pdf/renderer ships a native React reconciler + a yoga-layout wasm
    // build that must not be run through webpack — mark it external so the
    // download routes can require it at runtime on the Node serverless runtime.
    serverComponentsExternalPackages: ['@anthropic-ai/sdk', 'openai', '@react-pdf/renderer', 'xlsx'],
  },
}

module.exports = nextConfig
