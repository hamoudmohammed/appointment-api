import pg from 'pg';

const { Pool, types } = pg;

// Parse PostgreSQL DATE (OID 1082) as a plain ISO string (YYYY-MM-DD)
// to prevent unwanted local timezone shift conversions.
types.setTypeParser(1082, (val: string) => val);

export interface DatabaseConfig {
  connectionString?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  database?: string | undefined;
  ssl?: boolean | { rejectUnauthorized: boolean } | undefined;
}

export function getDatabaseConfig(): DatabaseConfig {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'appointments_db',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  };
}

export function createDatabasePool(config: DatabaseConfig = getDatabaseConfig()): pg.Pool {
  const poolConfig: pg.PoolConfig = {
    connectionString: config.connectionString,
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
    max: 20, // Max concurrent connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  };

  const pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error('[db] Unexpected error on idle PostgreSQL client:', err);
  });

  return pool;
}

export async function initializeDatabase(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        customer VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        time VARCHAR(5) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments (date, status);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_slot 
      ON appointments (date, time) 
      WHERE status = 'CONFIRMED';
    `);

    // Ensure initial seed exists if empty
    const countRes = await client.query('SELECT COUNT(*) FROM appointments');
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      await client.query(`
        INSERT INTO appointments (customer, date, time, status, created_at)
        VALUES ('Max Mustermann', '2026-11-20', '10:00', 'CONFIRMED', '2026-11-14 10:00:00+00')
      `);
      console.log('[db] Initial seed appointment inserted.');
    }

    console.log('[db] PostgreSQL database schema verified and initialized.');
  } finally {
    client.release();
  }
}
