const { existsSync } = require('node:fs');
const { join } = require('node:path');

if (!process.env.DATABASE_URL && existsSync(join(__dirname, '.env'))) {
  process.loadEnvFile(join(__dirname, '.env'));
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env or set the variable.');
}

module.exports = {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: join(__dirname, 'migrations'),
    loadExtensions: ['.cjs']
  }
};
