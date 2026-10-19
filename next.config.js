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
      // The Commercial hub page was removed; its three modules are listed
      // directly in the main Sidebar.
      { source: '/commercial', destination: '/dashboard', permanent: false },
      // Every module's media list became the central Media Library (migration
      // 039). Meeting Prep's ids were kept, so its edit links still resolve.
      { source: '/commercial/admin/meeting-prep/media-library/new', destination: '/admin/media-library', permanent: false },
      { source: '/commercial/admin/meeting-prep/media-library/:id', destination: '/admin/media-library/:id', permanent: false },
      { source: '/commercial/admin/meeting-prep/media-library', destination: '/admin/media-library', permanent: false },
      { source: '/copywriting/admin/publications', destination: '/admin/media-library', permanent: false },
      { source: '/admin/interview-letters/media', destination: '/admin/media-library', permanent: false },
    ]
  },
}

module.exports = nextConfig
