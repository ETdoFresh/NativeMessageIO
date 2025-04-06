import http from 'http';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { logStdErr } from './utils/logger.js';
import { messageEmitter, componentStatus, updateComponentStatus } from './state.js';
import { writeNativeMessage } from './native-messaging.js';
import { HTTP_PORT, SERVER_NAME, SERVER_VERSION } from './config.js';
import type { ComponentStatus } from './state.js';
import { handleIncomingCommandString } from './commands.js';

const app = express();
app.use(cors()); // Enable CORS for all origins
app.use(express.json()); // Middleware to parse JSON bodies

let sseClients: Response[] = [];
let httpServerInstance: http.Server | null = null;

// --- Shared Command Endpoint Logic ---
async function executeCommandAndRespond(commandString: string, res: Response) {
    logStdErr(`Executing command via API: "${commandString}"`);
    try {
        const responseString = await handleIncomingCommandString(commandString);
        let httpStatus = 200;
        if (responseString.startsWith('[ERROR]')) {
            httpStatus = 500;
        } else if (responseString.startsWith('[PENDING]')) {
            httpStatus = 202; // Accepted
        }
        res.status(httpStatus).json({ message: responseString });
    } catch (error) {
        logStdErr(`Unhandled error during command string execution triggered by API:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error during command execution.';
        res.status(500).json({ message: `[ERROR] ${errorMessage}` });
    }
}

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

// Function to send events to all connected SSE clients
export function sendSseEvent(type: string, data: any) {
    if (sseClients.length === 0) return;
    const payload = JSON.stringify(data);
    const message = `id: ${Date.now()}\nevent: ${type}\ndata: ${payload}\n\n`;
    logStdErr(`Sending SSE event '${type}' to ${sseClients.length} clients.`);
    sseClients.forEach(client => {
        try {
             client.write(message);
        } catch (error) {
             logStdErr(`Error sending SSE to a client:`, error);
        }
    });
}

// --- Specific Command Endpoints ---

// POST /command/ping
// Optional Body: { "payload": "string" }
app.post('/command/ping', async (req: Request, res: Response): Promise<void> => {
    const payload = req.body?.payload;
    let commandString = 'ping';
    if (payload && typeof payload === 'string') {
        commandString += ` ${payload}`;
    }
    await executeCommandAndRespond(commandString, res);
});

// POST /command/getBrowserLogs
// No body needed
app.post('/command/getBrowserLogs', async (req: Request, res: Response): Promise<void> => {
    const commandString = 'getBrowserLogs';
    await executeCommandAndRespond(commandString, res);
});

// GET /command/status
app.get('/command/status', async (req: Request, res: Response): Promise<void> => {
    const commandString = 'status';
    await executeCommandAndRespond(commandString, res);
});

// --- General Message Broadcast Endpoint (Example - Optional) ---
// If you still need a way to broadcast arbitrary messages via API
app.post('/broadcast', (req: Request, res: Response): void => {
    const messageData = req.body;
    if (!messageData) {
        res.status(400).json({ error: 'No message body provided for broadcast' });
        return;
    }
    logStdErr(`Broadcasting message from API via /broadcast:`, JSON.stringify(messageData).substring(0, 100) + "...");
    // Decide on broadcast format - keeping original structure for now
    messageEmitter.emit('message', { source: 'api-broadcast', data: messageData });
    res.status(200).json({ status: 'broadcasted', message: messageData });
});

// Error Handling Middleware (Express)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logStdErr(`Express Error:`, err.stack);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

export function startHttpServer(): Promise<http.Server | null> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        httpServerInstance = server; // Store instance

        server.listen(HTTP_PORT, () => {
            logStdErr(`Express API/SSE server listening on http://localhost:${HTTP_PORT}`);
            updateComponentStatus('http', 'OK');
            resolve(server);
        }).on('error', (err: NodeJS.ErrnoException) => {
            logStdErr(`FATAL: Express server error:`, err);
            const errMsg = (err && 'code' in err) ? err.code : err.message;
            updateComponentStatus('http', `Error: ${errMsg}`);
            writeNativeMessage({ status: "error", message: `HTTP server error: ${err.message}` }).catch(logStdErr);
            if (err.code === 'EADDRINUSE') {
                logStdErr(`*** Port ${HTTP_PORT} is already in use. Try setting NATIVE_MESSAGE_IO_PORT environment variable. ***`);
                writeNativeMessage({ status: "error", message: `Port ${HTTP_PORT} in use.` }).catch(logStdErr);
            }
            httpServerInstance = null; // Clear instance on error
            reject(err); // Reject the promise
        });
    });
}

export function getHttpServerInstance(): http.Server | null {
    return httpServerInstance;
}

export function stopHttpServer(callback: (err?: Error) => void) {
    sseClients.forEach(client => client.end());
    sseClients = [];
    if (httpServerInstance) {
        logStdErr(`Closing HTTP server...`);
        httpServerInstance.close((err) => {
            if (err) logStdErr(`Error closing HTTP server:`, err);
            else logStdErr(`HTTP server closed.`);
            httpServerInstance = null;
            callback(err);
        });
    } else {
        callback();
    }
} 