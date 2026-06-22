/** @type {import('next').NextConfig} */
const nextConfig = {
  // The engine library is plain ESM in the parent repo (file: dependency).
  transpilePackages: ['shopping-graph'],
  // transformers.js is an optional, dynamically-imported native dep — never bundle it.
  serverExternalPackages: ['@huggingface/transformers'],
};

export default nextConfig;
