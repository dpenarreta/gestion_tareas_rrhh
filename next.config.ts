import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: CSP },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@xenova/transformers", "pdf-parse"],
  // pdf-parse (vía pdfjs-dist) y @xenova/transformers (vía onnxruntime-node)
  // resuelven archivos nativos (worker de pdfjs, libonnxruntime.so) con una
  // ruta calculada en runtime según la plataforma, así que el output file
  // tracing de Vercel no los detecta como dependencia estática y los excluye
  // del bundle serverless — sin esto pdfjs-dist falla con "Cannot find
  // module '.../pdf.worker.mjs'" y @xenova/transformers con "cannot open
  // shared object file: libonnxruntime.so", ambos solo en producción (Linux),
  // nunca en local (Windows), porque ahí sí están instalados los binarios de
  // esa plataforma.
  outputFileTracingIncludes: {
    "/api/assistant/documents": [
      "./node_modules/pdfjs-dist/legacy/build/**/*",
      "./node_modules/onnxruntime-node/bin/**/*",
    ],
    "/api/assistant/chat": ["./node_modules/onnxruntime-node/bin/**/*"],
  },
  experimental: {
    // Next.js 16 renombró middleware.ts -> proxy.ts (ver src/proxy.ts) y ahora
    // bufferiza el body de cada request para poder leerlo tanto en el proxy
    // como en el route handler. El default es 10MB; no hay equivalente al
    // viejo `export const config = { api: { bodyParser } }` de Pages Router
    // para Route Handlers — este es el mecanismo real en App Router. Se fija
    // explícito por encima de nuestro propio límite de 4.5MB para subir PDFs
    // (ver MAX_SIZE_BYTES en src/app/api/assistant/documents/route.ts).
    proxyClientMaxBodySize: "8mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
