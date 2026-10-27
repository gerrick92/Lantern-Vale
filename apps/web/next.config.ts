import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../.."),
  poweredByHeader: false,
  devIndicators: false,
  images: { qualities: [60, 75] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'" +
              (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "") +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' https: ws://127.0.0.1:*; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
          },
        ],
      },
      {
        source: "/games/mosslight/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            // RPG Maker's bundled Pixi renderer compiles shaders with Function.
            // This exception is restricted to the static game, never account pages.
            value:
              "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
