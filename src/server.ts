import { createServer, Server } from 'node:http';
import pg from 'pg';
import { requestHandler, setAppointmentService } from './app.js';
import { AppointmentService } from './services/appointmentService.js';
import { createDatabasePool, initializeDatabase, getDatabaseConfig } from './db/pool.js';
import { PostgresAppointmentRepository } from './repositories/postgresAppointmentRepository.js';
import { InMemoryAppointmentRepository } from './repositories/inMemoryAppointmentRepository.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const USE_IN_MEMORY = process.env.USE_IN_MEMORY === 'true';

let server: Server;
let pool: pg.Pool | undefined;

async function bootstrap(): Promise<void> {
  if (USE_IN_MEMORY) {
    console.log('[appointment-api] Running with In-Memory storage (USE_IN_MEMORY=true).');
    setAppointmentService(new AppointmentService(new InMemoryAppointmentRepository()));
  } else {
    const config = getDatabaseConfig();
    console.log(
      `[appointment-api] Connecting to PostgreSQL at ${config.host || 'remote'}:${config.port || 5432}/${config.database || ''}...`
    );

    try {
      pool = createDatabasePool(config);
      await initializeDatabase(pool);
      const postgresRepo = new PostgresAppointmentRepository(pool);
      setAppointmentService(new AppointmentService(postgresRepo));
      console.log('[appointment-api] Successfully connected to PostgreSQL and initialized repository.');
    } catch (err) {
      console.error('[appointment-api] Failed to connect to PostgreSQL database:', err);
      console.warn('[appointment-api] Tip: Ensure PostgreSQL is running via `docker compose up -d` or set USE_IN_MEMORY=true.');
      process.exit(1);
    }
  }

  server = createServer(requestHandler);

  server.listen(PORT, HOST, () => {
    console.log(`[appointment-api] Server running on http://${HOST}:${PORT}`);
    console.log(`[appointment-api] Documentation (Swagger UI): http://${HOST}:${PORT}/docs`);
    console.log(`[appointment-api] Health check: http://${HOST}:${PORT}/health`);
  });
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[appointment-api] Received ${signal}. Initiating graceful shutdown...`);

  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log('[appointment-api] HTTP server closed cleanly.');
        resolve();
      });
    });
  }

  if (pool) {
    try {
      await pool.end();
      console.log('[appointment-api] PostgreSQL connection pool terminated.');
    } catch (err) {
      console.error('[appointment-api] Error while closing PostgreSQL pool:', err);
    }
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap().catch((err) => {
  console.error('[appointment-api] Fatal bootstrap error:', err);
  process.exit(1);
});
