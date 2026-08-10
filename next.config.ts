import type { NextConfig } from "next";

const isVercel = Boolean(process.env.VERCEL);
const backend = (process.env.HAYWIRE_API_URL || "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    // On Vercel multi-service deploys, /api/backend is rewritten in vercel.json
    // to the FastAPI service. Locally, proxy to the uvicorn process.
    if (isVercel && !backend) return [];
    const target = backend || "http://127.0.0.1:8000";
    return [
      {
        source: "/api/backend/:path*",
        destination: `${target}/:path*`,
      },
    ];
  },
};

export default nextConfig;
