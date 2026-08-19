import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@attest/core', '@attest/cardano', '@attest/keri', '@attest/blueprint'],
  serverExternalPackages: ['signify-ts'],
};

export default config;
