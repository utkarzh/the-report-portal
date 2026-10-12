/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // @react-pdf/renderer ships a native React reconciler + a yoga-layout wasm
    // build that must not be run through webpack — mark it external so the
    // download routes can require it at runtime on the Node serverless runtime.
    serverComponentsExternalPackages: ['@anthropic-ai/sdk', 'openai', '@react-pdf/renderer', 'xlsx'],
  },
  async redirects() {
    return [
      // The Knowledge Base admin area moved inside the module (like every
      // other module's admin tools). Keeps old bookmarks and links working.
      { source: '/admin/knowledge/:path*', destination: '/knowledge/admin/:path*', permanent: false },
    ]
  },
}

module.exports = nextConfig
