const { Redis } = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

redis.on('error', (err) => {
  // 静默，不让 Redis 断线导致进程崩溃
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[Redis] error:', err.message);
  }
});

module.exports = redis;
