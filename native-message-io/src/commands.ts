import { logStdErr } from './utils/logger.js';
import { writeNativeMessage } from './native-messaging.js';
import { SERVER_NAME, SERVER_VERSION, HTTP_PORT, PIPE_PATH } from './config.js'; // Import config
import { componentStatus } from './state.js'; // Import state

// Define the structure for messages sent TO the extension
interface ExtensionMessage {
    command: string;
    url?: string; // Optional: for create_tab
    args?: any;   // Optional: for generic args
}

// --- Core Command Handler --- Replaced
// Parses the input command string from IPC/other sources and forwards it
// as a JSON message to the browser extension via Native Messaging.
export async function forwardCommandStringToExtension(commandString: string): Promise<string> {
    logStdErr(`Forwarding command string: "${commandString}"`);

    // Basic parsing: command is the first word, rest is args string.
    // More sophisticated parsing could happen here if needed, or in the extension.
    const parts = commandString.trim().split(/\s+/);
    const commandName = parts[0];
    const argsString = parts.slice(1).join(' '); // Rejoin args

    if (!commandName) {
        return `[ERROR] Empty command string received.`;
    }

    // Construct the message object for the extension
    const message: ExtensionMessage = { command: commandName };

    // Simple argument handling: Check if it looks like a URL for create_tab
    // More complex commands might need structured args or parsing.
    if (commandName === 'create_tab' && argsString) {
        message.url = argsString; // Specific property for create_tab
    } else if (argsString) {
        // Generic args property for other commands (extension needs to handle)
        message.args = argsString;
    }
    // NOTE: Commands like get_console_logs, reload_extension don't need args here.

    try {
        await writeNativeMessage(message);
        logStdErr(`Forwarded message to extension: ${JSON.stringify(message)}`);
        // Return SUCCESS immediately, as the actual work/response happens in the extension.
        // The caller (e.g., IPC client) won't get the direct result of the browser action.
        return `[SUCCESS] Command "${commandName}" forwarded to browser extension.`;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logStdErr(`Error forwarding command "${commandName}" to extension:`, error);
        return `[ERROR] Failed to forward command to extension: ${errorMessage}`;
    }
}

// --- Keep Status Command Locally --- (Doesn't rely on extension)
async function handleStatusCommand(args: string[]): Promise<string> {
    logStdErr(`Executing status command.`);
    try {
        const statusObject = {
            serverName: SERVER_NAME,
            version: SERVER_VERSION,
            pid: process.pid,
            uptime: process.uptime(),
            listeningOn: {
                httpPort: HTTP_PORT,
                ipcPath: PIPE_PATH
            },
            components: componentStatus
        };
        return `[SUCCESS] ${JSON.stringify(statusObject)}`;
    } catch (error) {
        logStdErr(`Error generating status object:`, error);
        return `[ERROR] Failed to generate server status.`; // Return error string directly
    }
}

// --- Command Handling (for local commands like status) ---
// This map now only holds commands handled *entirely* within the native host.
type LocalCommandHandler = (args: string[]) => Promise<string>;
const localCommandRegistry = new Map<string, LocalCommandHandler>();

function registerLocalCommand(commandName: string, handler: LocalCommandHandler) {
    localCommandRegistry.set(commandName, handler);
    logStdErr(`Local command registered: ${commandName}`);
}

registerLocalCommand('status', handleStatusCommand);
// Potentially add a local 'help' command if needed.

// --- Handle Incoming Command String (Main Entry Point) ---
// Checks local commands first, then forwards to extension.
export async function handleIncomingCommandString(commandString: string): Promise<string> {
    const parts = commandString.trim().split(/\s+/);
    const commandName = parts[0];
    const args = parts.slice(1);

    const localHandler = localCommandRegistry.get(commandName);
    if (localHandler) {
        logStdErr(`Handling command locally: ${commandName}`);
        return await localHandler(args);
    }

    // If not a local command, forward it to the extension
    return await forwardCommandStringToExtension(commandString);
}