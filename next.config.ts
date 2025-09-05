import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/mapi/:path*', destination: 'http://localhost:2000/:path*' },
      { source: '/ncapi/:path*', destination: 'http://localhost:1000/:path*' }
    ];
  }
};
export default nextConfig;
 