import { createServer } from 'node:http';
import { requestHandler } from './app.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const server = createServer(requestHandler);

server.listen(PORT, HOST, () => {
  console.log(`[appointment-api] Server running on http://${HOST}:${PORT}`);
  console.log(`[appointment-api] Health check: http://${HOST}:${PORT}/health`);
  console.log(`[appointment-api] Appointments endpoint: http://${HOST}:${PORT}/appointments`);
});

// Graceful shutdown handling (crucial for containerized/cloud environments like Docker/Kubernetes/AWS ECS)
function shutdown(signal: string) {
  console.log(`[appointment-api] Received ${signal}. Closing HTTP server gracefully...`);
  server.close(() => {
    console.log('[appointment-api] HTTP server closed cleanly.');
    process.exit(0);
  });

  // Force close if graceful termination hangs
  setTimeout(() => {
    console.error('[appointment-api] Forced shutdown after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
