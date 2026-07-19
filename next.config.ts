import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Map previews live in /public/maps and are served statically; nothing special needed.
  // The /design folder is a spec artifact, not part of the app bundle.
  outputFileTracingExcludes: { "*": ["./design/**"] },
};

export default nextConfig;
