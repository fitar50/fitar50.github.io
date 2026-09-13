
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const sql = fs.readFileSync('./schema.sql', 'utf8');
  try {
    await pool.query(sql);
    console.log('✓ Schema applied');
  } catch (err) {
    console.error('✗ Failed:', err.message);
  } finally {
    await pool.end();
  }
}

main();
