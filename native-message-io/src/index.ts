import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import path from 'path';
import * as os from 'os';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';

// MCP Imports
// import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
// import { z } from 'zod';
// import { zodToJsonSchema } from 'zod-to-json-schema';

// Local Modules
import { logStdErr } from './utils/logger.js';
import { messageEmitter, componentStatus, updateComponentStatus } from './state.js';
import { HTTP_PORT, SERVER_NAME, SERVER_VERSION } from './config.js';
import { listenForNativeMessages, writeNativeMessage } from './native-messaging.js';
import { startHttpServer, stopHttpServer, sendSseEvent } from './api-server.js';
import { startIpcServer, stopIpcServer } from './ipc-server.js';
import { startMcpServer, stopMcpServer } from './mcp-server.js';

// --- Configuration ---
// const HTTP_PORT = process.env.NATIVE_MESSAGE_IO_PORT || 3580;
// const SERVER_NAME = "native-message-io-multi";
// const SERVER_VERSION = "1.2.1";

// --- IPC Configuration ---
// const PIPE_NAME = 'native-message-io-ipc-pipe';
// const PIPE_PATH = process.platform === 'win32'
//     ? path.join('\\.\pipe\', PIPE_NAME)
//     : path.join(os.tmpdir(), `${PIPE_NAME}.sock`);

// --- Central Event Emitter ---
// const messageEmitter = new EventEmitter();

// --- Server Instances (managed within their modules now) ---
// let httpServer: http.Server | null = null;
// let ipcServer: net.Server | null = null;
// let mcpServer: McpServer | null = null;

// --- Component Status Tracking ---
// let componentStatus = {
//     http: "pending",
//     ipc: "pending",
//     mcp: "pending",
//     nativeMessaging: "pending"
// };

// --- Logging Helper ---
// function logStdErr(message: string, ...optionalParams: any[]): void { ... }

// --- Native Messaging (moved to native-messaging.ts) ---

// --- Express API Server with SSE (moved to api-server.ts) ---
const app = express();
app.use(cors()); // Enable CORS for all origins
app.use(express.json()); // Middleware to parse JSON bodies

let sseClients: Response[] = [];

// SSE Endpoint
app.get('/events', (req: Request, res: Response) => {
    logStdErr(`SSE client connected from ${req.ip}`);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Send headers immediately

    res.write(`id: ${Date.now()}\nevent: connection\ndata: {"message": "Connected to NativeMessageIO SSE"}\n\n`);
    sseClients.push(res);

    req.on('close', () => {
        logStdErr(`SSE client disconnected from ${req.ip}`);
        sseClients = sseClients.filter(client => client !== res);
        res.end();
    });

    const keepAliveInterval = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 30000);

    res.on('finish', () => {
        clearInterval(keepAliveInterval);
    });
});

// --- MCP Server (moved to mcp-server.ts) ---

// --- IPC Server (moved to ipc-server.ts) ---

// --- Message Broadcasting Logic ---
messageEmitter.on('message', (messagePayload: { source: string, data: any }) => {
    logStdErr(`Broadcasting message from ${messagePayload.source}...`);

    // Send to Firefox via Native Messaging (unless it was the source)
    if (messagePayload.source !== 'native-messaging') {
         writeNativeMessage({ type: "broadcast", source: messagePayload.source, data: messagePayload.data })
            .catch(err => logStdErr(`Error sending broadcast to Native Messaging:`, err));
    }

    // Send to connected SSE clients (using the function from api-server)
    sendSseEvent({ type: 'message', source: messagePayload.source, data: messagePayload.data });

    // Other broadcasting (MCP, IPC) if needed would be handled similarly or via direct responses.
});

// --- Server Startup ---
async function main() {
    logStdErr(`${SERVER_NAME} v${SERVER_VERSION} Starting... (PID: ${process.pid})`);

    // Start Native Messaging listener first
    listenForNativeMessages();
    updateComponentStatus('nativeMessaging', 'listening');

    // Start MCP Server (Readline forwarder mode)
    startMcpServer(); 

    // Start IPC and HTTP servers in parallel
    const servers = await Promise.allSettled([
        startIpcServer(),
        startHttpServer()
    ]);

    // Check server startup results
    if (servers[0].status === 'rejected') {
        logStdErr('IPC Server failed to start:', servers[0].reason);
        updateComponentStatus('ipc', `Failed: ${servers[0].reason?.message || 'Unknown error'}`);
    }
    if (servers[1].status === 'rejected') {
        logStdErr('HTTP Server failed to start:', servers[1].reason);
        updateComponentStatus('http', `Failed: ${servers[1].reason?.message || 'Unknown error'}`);
    }

    // Send ready signal via Native Messaging
    try {
        const httpAddress = (servers[1].status === 'fulfilled' && servers[1].value) ? servers[1].value.address() : null;
        const httpPort = (httpAddress && typeof httpAddress === 'object') ? httpAddress.port : undefined;

        await writeNativeMessage({
            status: "ready",
            pid: process.pid,
            server: SERVER_NAME,
            version: SERVER_VERSION,
            components: componentStatus,
            httpPort: httpPort,
            message: "Server ready signal sent. Check component status."
        });
        logStdErr("Sent ready signal via Native Messaging with component status and HTTP port.");
    } catch (err) {
        logStdErr("Error sending ready signal via Native Messaging:", err);
    }

    logStdErr("All components initialized or initialization attempted.");
}

// Basic process exit logging (no complex shutdown logic for now)
process.on('SIGINT', () => { logStdErr('Received SIGINT. Exiting...'); process.exit(0); });
process.on('SIGTERM', () => { logStdErr('Received SIGTERM. Exiting...'); process.exit(0); });
process.on('exit', (code) => logStdErr(`Exiting with code ${code}.`));

main().catch(err => {
    logStdErr("Unhandled error during main execution:", err);
    process.exit(1);
}); 