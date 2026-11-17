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
    try {
      console.log(
        `[appointment-api] Connecting to PostgreSQL at ${config.host || 'localhost'}:${config.port || 5432}/${config.database || ''}...`
      );
      pool = createDatabasePool(config);
      await initializeDatabase(pool);
      const postgresRepo = new PostgresAppointmentRepository(pool);
      setAppointmentService(new AppointmentService(postgresRepo));
      console.log('[appointment-api] Successfully connected to PostgreSQL and initialized repository.');
    } catch (err) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[appointment-api] Fatal: Failed to connect to PostgreSQL in production:', err);
        process.exit(1);
      } else {
        console.warn(
          '[appointment-api] PostgreSQL is not running locally. Falling back to In-Memory storage for development.'
        );
        console.warn(
          '[appointment-api] (To connect with PostgreSQL, start Docker Desktop and run: docker compose up -d)'
        );
        pool = undefined;
        setAppointmentService(new AppointmentService(new InMemoryAppointmentRepository()));
      }
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
