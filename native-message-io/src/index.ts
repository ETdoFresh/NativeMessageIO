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
import { setupMcpServer } from './mcp-server.js';

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
    sendSseEvent('message', { source: messagePayload.source, data: messagePayload.data });

    // Other broadcasting (MCP, IPC) if needed would be handled similarly or via direct responses.
});

// --- Server Startup ---
async function startServer() {
    logStdErr(`v${SERVER_VERSION} Starting... (PID: ${process.pid})`);

    // 1. Start Native Messaging Listener
    try {
        listenForNativeMessages();
        updateComponentStatus('nativeMessaging', 'listening');
    } catch (e) {
        logStdErr("Failed to start native messaging listener", e);
        updateComponentStatus('nativeMessaging', 'error');
        // Potentially exit if native messaging is critical
        // process.exit(1);
    }

    // 2. Start MCP Server Part (Needs to be early for potential immediate exit)
    // setupMcpServer now handles its own status updates and exits on fatal errors.
    setupMcpServer();

    // 3. Start HTTP and IPC servers concurrently
    const startupPromises = [
        startHttpServer(),
        startIpcServer()
    ];

    try {
        // Wait for both HTTP and IPC server startup attempts to complete.
        // Note: startIpcServer is designed to resolve even on error to allow startup continuation.
        // startHttpServer will reject on error.
        await Promise.all(startupPromises.map(p => p.catch(e => e))); // Catch individual errors

        logStdErr(`Server startup sequence finished. Status:`, componentStatus);

        // 4. Send ready signal via Native Messaging (if it's working)
        if (componentStatus.nativeMessaging === "listening") {
            await writeNativeMessage({
                status: "ready",
                pid: process.pid,
                server: SERVER_NAME,
                version: SERVER_VERSION,
                components: componentStatus,
                httpPort: HTTP_PORT,
                message: "Server ready signal sent. Check component status."
            });
            logStdErr(`Sent ready signal via Native Messaging with component status and HTTP port.`);
        } else {
             logStdErr(`Native messaging not available, cannot send ready signal.`);
        }

    } catch (error) {
        // This catch might be less likely now unless startHttpServer rejects unhandled
        logStdErr(`FATAL: Unhandled error during server startup sequence:`, error);
        // Ensure status reflects failure if possible
        if (componentStatus.http === 'pending' || componentStatus.http === 'OK') updateComponentStatus('http', 'Error: Unknown startup failure');
        if (componentStatus.ipc === 'pending' || componentStatus.ipc === 'OK') updateComponentStatus('ipc', 'Error: Unknown startup failure');
        process.exit(1); // Exit on major unhandled issue in startup orchestration
    }
    logStdErr(`All components initialized or initialization attempted.`);
}

// --- Graceful Shutdown ---
function shutdown(signal: string) {
    logStdErr(`Received ${signal}. Shutting down...`);
    messageEmitter.removeAllListeners();

    let httpClosed = false;
    let ipcClosed = false;
    const forcedExitTimeout = 5000; // 5 seconds

    const checkExit = () => {
        if (httpClosed && ipcClosed) {
            logStdErr(`All servers closed gracefully. Exiting.`);
            // No need to call cleanupPipe here, stopIpcServer handles it.
            clearTimeout(forceExitTimer); // Clear timeout once shutdown is successful
            process.exit(0);
        }
    };

    const forceExitTimer = setTimeout(() => {
        logStdErr(`Shutdown timeout (${forcedExitTimeout}ms) reached. Forcing exit.`);
        // Ensure IPC cleanup is attempted on forced exit
        stopIpcServer(() => {}); // Call stopIpcServer to attempt cleanup
        process.exit(1);
    }, forcedExitTimeout);

    // Use stop functions from modules
    stopHttpServer((err) => {
        if (err) logStdErr('Error stopping HTTP server during shutdown:', err);
        httpClosed = true;
        checkExit();
    });

    stopIpcServer((err) => {
        if (err) logStdErr('Error stopping IPC server during shutdown:', err);
        ipcClosed = true;
        checkExit();
    });

     // Check exit immediately in case both servers were already stopped/failed
    checkExit();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', (code) => {
    logStdErr(`Exiting with code ${code}`);
    // Cleanup is handled by stopIpcServer now
});

// Start the server!
startServer().catch(error => {
     logStdErr(`Fatal error during top-level startup orchestration:`, error);
     process.exit(1);
}); 