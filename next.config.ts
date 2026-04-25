import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export — emits a fully-static `out/` directory that Azure Static
  // Web Apps serves directly. Required because the site is 100% client-side
  // (no API routes, no SSR) and SWA's free tier ships static html + assets.
  output: "export",
  // Static export forbids next/image's optimization. We use raw <img> tags
  // for the brand mark; this just makes any future next/image fall back
  // gracefully instead of failing the build.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
