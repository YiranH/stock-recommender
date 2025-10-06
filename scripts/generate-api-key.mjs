#!/usr/bin/env node

import { randomBytes } from 'node:crypto';

const BYTES_DEFAULT = 32;
const MIN_BYTES = 16;
const MAX_BYTES = 64;

const arg = process.argv[2];
const requestedBytes = arg ? Number.parseInt(arg, 10) : BYTES_DEFAULT;

if (!Number.isInteger(requestedBytes) || requestedBytes < MIN_BYTES || requestedBytes > MAX_BYTES) {
  console.error(`Usage: node scripts/generate-api-key.mjs [bytes]\n- bytes must be an integer between ${MIN_BYTES} and ${MAX_BYTES}`);
  process.exit(1);
}

const keyBuffer = randomBytes(requestedBytes);
const apiKey = keyBuffer.toString('base64url');

console.log(apiKey);
