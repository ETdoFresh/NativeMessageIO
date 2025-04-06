import { logStdErr } from './utils/logger.js';
import { writeNativeMessage } from './native-messaging.js';
import { SERVER_NAME, SERVER_VERSION, HTTP_PORT, PIPE_PATH } from './config.js'; // Import config
import { componentStatus } from './state.js'; // Import state

// --- Simplified Command Handling ---

// No specific CommandMessage/CommandResponse interfaces needed anymore.

// --- Command Handler Type ---
// Takes arguments parsed from the message string, returns a single response string.
type CommandHandler = (args: string[]) => Promise<string>;

// --- Command Registry ---
const commandRegistry = new Map<string, CommandHandler>();

// --- Register Command Function ---
function registerCommand(commandName: string, handler: CommandHandler) {
    if (commandRegistry.has(commandName)) {
        logStdErr(`Warning: Command "${commandName}" is already registered. Overwriting.`);
    }
    commandRegistry.set(commandName, handler);
    logStdErr(`Command registered: ${commandName}`);
}

// --- Core Command Handler ---
// Parses the input string and executes the corresponding command handler.
export async function handleCommandString(message: string): Promise<string> {
    logStdErr(`Handling command string: "${message}"`);

    // Simple space splitting for command and args.
    // WARNING: This is basic and won't handle args with spaces correctly.
    // More robust parsing (e.g., using quotes or a library) might be needed.
    const parts = message.trim().split(/\s+/);
    const commandName = parts[0];
    const args = parts.slice(1);

    const handler = commandRegistry.get(commandName);

    if (!handler) {
        const errorMsg = `Unknown command: ${commandName}`;
        logStdErr(`Error: ${errorMsg}`);
        return `[ERROR] ${errorMsg}`;
    }

    try {
        // Execute the handler and return its string response
        // Status prefix ([SUCCESS], [ERROR], etc.) should be added by the handler itself.
        return await handler(args);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logStdErr(`Error executing command "${commandName}":`, error);
        return `[ERROR] ${errorMessage}`;
    }
}

// --- Built-in Commands ---

// Example: Ping command
// Usage: `ping` or `ping custom_response`
async function handlePing(args: string[]): Promise<string> {
    const responseText = args.length > 0 ? args.join(' ') : 'hello';
    return `[SUCCESS] pong ${responseText}`;
}

// Command: Get Browser Logs
// Usage: `getBrowserLogs`
async function handleGetBrowserLogs(args: string[]): Promise<string> {
    logStdErr(`Executing getBrowserLogs command. Sending 'get-logs' via Native Messaging.`);
    try {
        // Native message format itself might need adjustment later if it also must conform
        await writeNativeMessage({ command: "get-logs" });
        return `[PENDING] Log request sent to browser extension.`;
    } catch (err) {
         logStdErr(`Error sending get-logs command to Native Messaging:`, err);
         // Let handleCommandString catch and format the error prefix
         throw new Error('Failed to send log request to browser extension.');
    }
}

// Command: Get Server Status
// Usage: `status`
async function handleStatusCommand(args: string[]): Promise<string> {
    logStdErr(`Executing status command.`);
    try {
        const statusObject = {
            // status: "running", // Implied by SUCCESS prefix
            serverName: SERVER_NAME,
            version: SERVER_VERSION,
            pid: process.pid,
            uptime: process.uptime(),
            listeningOn: {
                httpPort: HTTP_PORT,
                ipcPath: PIPE_PATH
                // sseClients: Cannot get live count easily from here
            },
            components: componentStatus
        };
        // Serialize the status object into the success message
        return `[SUCCESS] ${JSON.stringify(statusObject)}`;
    } catch (error) {
        logStdErr(`Error generating status object:`, error);
        throw new Error('Failed to generate server status.'); // Let handleCommandString format error
    }
}

// --- Register Built-in Commands ---
registerCommand('ping', handlePing);
registerCommand('getBrowserLogs', handleGetBrowserLogs);
registerCommand('status', handleStatusCommand); // Register new command

// --- TODO: Add more commands here --- 