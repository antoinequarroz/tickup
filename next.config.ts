import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image.
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "@sentry/node"],
  async rewrites() {
    return [
      // The MCP server at a short address, and the OAuth discovery documents where clients look for them.
      { source: "/mcp", destination: "/api/mcp" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata" },
      { source: "/.well-known/openid-configuration/:path*", destination: "/api/oauth/metadata" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Private projects: never inside someone else's page, never leaking its URLs.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
