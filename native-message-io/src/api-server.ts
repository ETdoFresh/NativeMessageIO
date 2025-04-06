import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import { logStdErr } from './utils/logger.js';
import { HTTP_PORT } from './config.js';
import { updateComponentStatus } from './state.js';
import { writeNativeMessage } from './native-messaging.js';

let httpServerInstance: http.Server | null = null;

const app = express();
app.use(cors());
app.use(express.json());

let sseClients: Response[] = [];

export function sendSseEvent(data: object) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => client.write(message));
}

app.get('/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);
    logStdErr(`SSE client connected. Total clients: ${sseClients.length}`);

    // Send initial connection message if needed
    sendSseEvent({ type: 'connection', status: 'established' });

    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
        logStdErr(`SSE client disconnected. Total clients: ${sseClients.length}`);
    });
});

// POST /command
app.post('/command', async (req, res) => {
    const commandObject = req.body;
    logStdErr('[API Server] Received POST /command:', commandObject);

    if (!commandObject || typeof commandObject.message !== 'string') {
        logStdErr('[API Server] Invalid command format. Expected { message: "string" }');
        return res.status(400).json({ error: 'Invalid command format. Expected JSON { "message": "string" }' });
    }
    const commandString = commandObject.message;
    let responseMessage: string;
    let httpStatus = 500;

    try {
        // --- Directly forward the raw command string --- 
        await writeNativeMessage({ rawCommand: commandString });
        logStdErr(`Forwarded raw command to extension: ${commandString}`);
        responseMessage = `[SUCCESS] Command string forwarded to browser extension.`;
        httpStatus = 200; // Indicate success (forwarding attempted)
    } catch (forwardError) {
        const errorMessage = forwardError instanceof Error ? forwardError.message : String(forwardError);
        logStdErr(`Error forwarding raw command "${commandString}" to extension:`, forwardError);
        responseMessage = `[ERROR] Failed to forward command to extension: ${errorMessage}`;
        httpStatus = 500; // Internal server error
    }

    // Send response back to HTTP client
    res.status(httpStatus).json({ message: responseMessage });

});

// GET /status (Simple HTTP status, not the native host status command)
app.get('/status', (req, res) => {
    res.json({ status: 'running', timestamp: Date.now() });
});

export function startHttpServer(): Promise<http.Server | null> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        httpServerInstance = server;
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
            httpServerInstance = null;
            reject(err); // Reject the promise on startup error
        });
    });
}

export function getHttpServerInstance(): http.Server | null { return httpServerInstance; }

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