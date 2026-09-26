import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const RedisMock = require('ioredis-mock');
export default RedisMock;
