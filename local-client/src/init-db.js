require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function initDatabase() {
  const schemaPath = path.join(__dirname, '..', 'sql', 'local-schema.sql');

  console.log('[init-db] Reading schema from:', schemaPath);

  let sql;
  try {
    sql = fs.readFileSync(schemaPath, 'utf-8');
  } catch (err) {
    console.error('[init-db] Failed to read schema file:', err.message);
    process.exit(1);
  }

  console.log('[init-db] Connecting to database...');

  let client;
  try {
    client = await pool.connect();
    console.log('[init-db] Connected. Executing schema...');
    await client.query(sql);
    console.log('[init-db] Schema applied successfully.');
  } catch (err) {
    console.error('[init-db] Failed to apply schema:', err.message);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
    console.log('[init-db] Database connection closed.');
  }
}

initDatabase();
