import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["tesseract.js", "@napi-rs/canvas", "pdfjs-dist"],
  // These are loaded by a runtime path, which the file tracer does not follow.
  // A missing pdf.js worker throws. A missing Tesseract wasm never resolves,
  // so the upload stays on "Reading…".
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/tesseract.js-core/*.wasm",
    ],
  },
};

export default nextConfig;
