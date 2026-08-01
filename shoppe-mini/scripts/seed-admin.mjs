import 'dotenv/config';
import bcrypt from 'bcrypt';
import pg from 'pg';

const { Client } = pg;

const adminEmail = process.env.SEED_ADMIN_EMAIL;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL');
}

if (!adminEmail || !adminPassword) {
  throw new Error('Missing SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD');
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const roleResult = await client.query('SELECT id FROM roles WHERE name = $1', ['ADMIN']);

  if (roleResult.rowCount === 0) {
    throw new Error('Role ADMIN does not exist. Run the main seed/migration first.');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const roleId = roleResult.rows[0].id;

  await client.query(
    `INSERT INTO users (email, password_hash, full_name, role_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email)
     DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name,
       role_id = EXCLUDED.role_id`,
    [adminEmail, passwordHash, 'Administrator', roleId],
  );

  console.log(`Admin seeded: ${adminEmail}`);
} finally {
  await client.end();
}
