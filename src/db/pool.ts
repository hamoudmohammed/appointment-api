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
        email VARCHAR(255),
        phone VARCHAR(50),
        provider VARCHAR(100) NOT NULL DEFAULT 'General',
        service_type VARCHAR(50) NOT NULL DEFAULT 'CONSULTATION',
        notes TEXT,
        date DATE NOT NULL,
        time VARCHAR(5) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS provider VARCHAR(100) NOT NULL DEFAULT 'General';
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_type VARCHAR(50) NOT NULL DEFAULT 'CONSULTATION';
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT;

      DO $$
      BEGIN
        ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
        ALTER TABLE appointments ADD CONSTRAINT appointments_status_check CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'));
      EXCEPTION
        WHEN OTHERS THEN NULL;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments (date, status);
      CREATE INDEX IF NOT EXISTS idx_appointments_service_type ON appointments (service_type);
      CREATE INDEX IF NOT EXISTS idx_appointments_provider ON appointments (LOWER(provider));

      DROP INDEX IF EXISTS idx_unique_confirmed_slot;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_slot 
      ON appointments (date, time, LOWER(provider)) 
      WHERE status = 'CONFIRMED';

      CREATE TABLE IF NOT EXISTS appointment_history (
        id SERIAL PRIMARY KEY,
        appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        action VARCHAR(30) NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
        previous_values JSONB,
        new_values JSONB,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_appointment_history_appointment_id
      ON appointment_history (appointment_id, timestamp ASC, id ASC);
    `);

    // Ensure initial seed exists if empty
    const countRes = await client.query('SELECT COUNT(*) FROM appointments');
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      await client.query(`
        INSERT INTO appointments (customer, email, phone, provider, service_type, notes, date, time, status, created_at)
        VALUES ('Max Mustermann', 'max@example.com', '+49 151 12345678', 'General', 'CONSULTATION', 'Initial consultation session', '2026-11-20', '10:00', 'CONFIRMED', '2026-11-14 10:00:00+00')
      `);
      await client.query(`
        INSERT INTO appointment_history (appointment_id, action, new_values, timestamp)
        SELECT 1, 'CREATED', '{"customer":"Max Mustermann","provider":"General","serviceType":"CONSULTATION","date":"2026-11-20","time":"10:00","status":"CONFIRMED"}'::jsonb, '2026-11-14 10:00:00+00'
        WHERE EXISTS (SELECT 1 FROM appointments WHERE id = 1)
          AND NOT EXISTS (SELECT 1 FROM appointment_history WHERE appointment_id = 1)
      `);
      console.log('[db] Initial seed appointment inserted.');
    }

    console.log('[db] PostgreSQL database schema verified and initialized.');
  } finally {
    client.release();
  }
}

export interface DatabaseHealthStatus {
  status: 'healthy' | 'unhealthy';
  storage: 'postgresql' | 'in-memory';
  latencyMs: number;
  pool?: {
    total: number;
    idle: number;
    waiting: number;
  } | undefined;
  error?: string | undefined;
}

export async function checkDatabaseHealth(pool?: pg.Pool): Promise<DatabaseHealthStatus> {
  if (!pool) {
    return {
      status: 'healthy',
      storage: 'in-memory',
      latencyMs: 0
    };
  }

  const start = performance.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      const latencyMs = Number((performance.now() - start).toFixed(2));
      return {
        status: 'healthy',
        storage: 'postgresql',
        latencyMs,
        pool: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount
        }
      };
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const latencyMs = Number((performance.now() - start).toFixed(2));
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'unhealthy',
      storage: 'postgresql',
      latencyMs,
      error: message
    };
  }
}
