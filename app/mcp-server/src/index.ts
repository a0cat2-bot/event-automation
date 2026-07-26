import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { registerApplicantTools } from './tools/applicants.js';
import { registerGiftTools } from './tools/gifts.js';
import { registerLetterTools } from './tools/letters.js';
import { registerParticipantTools } from './tools/participants.js';
import { registerProgramTools } from './tools/programs.js';
import { registerReportTools } from './tools/reports.js';
import { registerSallyTools } from './tools/sally.js';
import { registerSelectionTools } from './tools/selection.js';

const transportName = process.env.MCP_TRANSPORT ?? 'http';
const port = Number(process.env.MCP_PORT ?? 3100);
const backendApiUrl = process.env.BACKEND_API_URL ?? 'http://localhost:3000/api/v1';

function buildServer(): McpServer {
  const server = new McpServer({
    name: '@event-automation/mcp-server',
    version: '0.1.0',
  });
  registerProgramTools(server, backendApiUrl);
  registerApplicantTools(server, backendApiUrl);
  registerSelectionTools(server, backendApiUrl);
  registerSallyTools(server, backendApiUrl);
  registerParticipantTools(server, backendApiUrl);
  registerLetterTools(server, backendApiUrl);
  registerGiftTools(server, backendApiUrl);
  registerReportTools(server, backendApiUrl);
  return server;
}

async function startHttp(): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`MCP_PORT must be an integer from 1 to 65535; received ${process.env.MCP_PORT}`);
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.post('/mcp', async (request: Request, response: Response) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error('MCP HTTP request failed:', error instanceof Error ? error.message : error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port, () => {
      console.log(`MCP server running on http://localhost:${port}/mcp (backend: ${backendApiUrl})`);
      resolve();
    });
    httpServer.on('error', reject);
  });
}

async function startStdio(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error(`MCP server running on stdio (backend: ${backendApiUrl})`);
}

async function main(): Promise<void> {
  if (transportName === 'http') {
    await startHttp();
  } else if (transportName === 'stdio') {
    await startStdio();
  } else {
    throw new Error(`MCP_TRANSPORT must be "http" or "stdio"; received "${transportName}"`);
  }
}

main().catch((error: unknown) => {
  console.error('Failed to start MCP server:', error instanceof Error ? error.message : error);
  process.exit(1);
});
