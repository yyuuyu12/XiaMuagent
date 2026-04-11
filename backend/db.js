const { Pool } = require('pg');

const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URI || process.env.POSTGRES_CONNECTION_STRING;

const pool = new Pool({
  connectionString: connStr,
  ssl: connStr ? { rejectUnauthorized: false } : false,
  max: 10,
});

pool.on('error', (err) => {
  console.error('[DB] PostgreSQL pool error:', err.message);
});

module.exports = pool;
