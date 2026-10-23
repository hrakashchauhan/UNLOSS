import 'dotenv/config';
import { createServer, type Server } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { assertRuntimeSupported, ConfigurationError, ProductionNotReadyError, loadConfig, type Config } from './config.js';
import { checkDatabase, createDatabase } from './database.js';
import { createLogger, type Logger } from './logger.js';
import { startSecurityMaintenance } from './maintenance.js';

export async function startServer(config: Config, logger: Logger, prisma: PrismaClient = createDatabase(config)) {
  let server: Server | undefined;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  try {
    assertRuntimeSupported(config);
    await prisma.$connect();
    await checkDatabase(prisma);
    const app = createApp({ config, prisma, logger, isShuttingDown: () => shuttingDown });
    server = await new Promise<Server>((resolve, reject) => {
      // Audited foundation only: legacy workflows stay on loopback until hardened.
      const listener = createServer(app);
      listener.once('error', reject);
      listener.listen(config.port, '127.0.0.1', () => resolve(listener));
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    logger.info('server.started', { port: config.port, mode: config.demo ? 'demo' : 'manual' });
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
  const listener = server;
  const stopMaintenance = startSecurityMaintenance(prisma, logger);
  return {
    server: listener,
    shutdown(): Promise<void> {
      shutdownPromise ??= (async () => {
        shuttingDown = true;
        try {
          await new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(() => listener.closeAllConnections(), 10_000);
            deadline.unref();
            listener.close(error => {
              clearTimeout(deadline);
              if (error) reject(error); else resolve();
            });
          });
        } finally { await stopMaintenance(); await prisma.$disconnect(); }
        logger.info('server.stopped');
      })();
      return shutdownPromise;
    },
  };
}

async function main() {
  const logger = createLogger();
  try {
    const config = loadConfig();
    const runtime = await startServer(config, logger);
    const shutdown = () => {
      void runtime.shutdown().catch(() => {
        logger.error('server.shutdown_failed', { code: 'SHUTDOWN_FAILED' });
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    logger.error('server.start_failed', error instanceof ConfigurationError
      ? { code: 'CONFIGURATION_INVALID', fields: error.fields }
      : { code: error instanceof ProductionNotReadyError ? 'PRODUCTION_NOT_READY' : 'STARTUP_FAILED' });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
