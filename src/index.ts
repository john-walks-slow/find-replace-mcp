import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { cleanupTrackedTempFiles } from './file-io.js';
import { createServer } from './server.js';

const server = createServer();

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

let shuttingDown = false;

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  try {
    await cleanupTrackedTempFiles();
  } finally {
    try {
      await server.close();
    } finally {
      process.exit(exitCode);
    }
  }
}

process.on('SIGINT', () => {
  void shutdown(0);
});

process.on('SIGTERM', () => {
  void shutdown(0);
});

process.on('uncaughtException', (error) => {
  console.error(error);
  void shutdown(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(reason);
  void shutdown(1);
});

void main();
