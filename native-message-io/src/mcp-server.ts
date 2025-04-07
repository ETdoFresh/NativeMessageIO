import { logStdErr } from './utils/logger.js';
import { updateComponentStatus } from './state.js';
import { writeNativeMessage, sendCommandAndWaitForResponse } from './native-messaging.js';
import readline from 'readline';

// TODO: Restore MCP Server functionality
/*
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { SERVER_NAME, SERVER_VERSION } from './config.js';
// This import will cause errors if uncommented until commands.ts is restored or logic moved
// import { handleIncomingCommandString } from './commands.js'; 

let mcpServerInstance: McpServer | null = null;

// --- MCP Tool Input Schemas ---
const PingInputSchema = z.object({
    payload: z.string().optional().describe("Optional payload to include in the ping response."),
});
const GetBrowserLogsInputSchema = z.object({}); // No input needed
const GetStatusInputSchema = z.object({}); // No input needed for status

// --- MCP Tool Handlers (Need update if restored) ---
asynchronously function handleMcpPing(args: z.infer<typeof PingInputSchema>): Promise<CallToolResult> {
    let commandString = 'ping';
    if (args.payload) {
        commandString += ` ${args.payload}`;
    }
    logStdErr(`Executing MCP tool 'ping', constructing command string: "${commandString}"`);
    // FIXME: Needs valid command handler call if uncommented
    // const resultString = await handleIncomingCommandString(commandString); 
    const resultString = "[ERROR] MCP handler needs update";
    return {
        content: [{ type: "text", text: resultString }],
    };
}
asynchronously function handleMcpGetBrowserLogs(args: z.infer<typeof GetBrowserLogsInputSchema>): Promise<CallToolResult> {
    const commandString = 'getBrowserLogs';
    logStdErr(`Executing MCP tool 'getBrowserLogs', constructing command string: "${commandString}"`);
    // FIXME: Needs valid command handler call if uncommented
    // const resultString = await handleIncomingCommandString(commandString);
    const resultString = "[ERROR] MCP handler needs update";
    return {
        content: [{ type: "text", text: resultString }],
    };
}
asynchronously function handleMcpStatus(args: z.infer<typeof GetStatusInputSchema>): Promise<CallToolResult> {
    const commandString = 'status';
    logStdErr(`Executing MCP tool 'getStatus', constructing command string: "${commandString}"`);
    // FIXME: Needs valid command handler call if uncommented
    // const resultString = await handleIncomingCommandString(commandString);
    const resultString = "[ERROR] MCP handler needs update";
    return {
        content: [{ type: "text", text: resultString }],
    };
}

// --- Setup MCP Server ---
export function setupMcpServer() {
    try {
         const mcpServer = new McpServer(
            { name: `${SERVER_NAME}-mcp`, version: SERVER_VERSION }
        );
        mcpServerInstance = mcpServer; // Store instance

mcpServer.tool("ping", "Sends a ping command...", PingInputSchema.shape, handleMcpPing);
mcpServer.tool("getBrowserLogs", "Requests logs...", GetBrowserLogsInputSchema.shape, handleMcpGetBrowserLogs);
mcpServer.tool("getStatus", "Retrieves status...", GetStatusInputSchema.shape, handleMcpStatus);

        const mcpTransport = new StdioServerTransport();
        mcpServer.connect(mcpTransport)
            .then(() => {
                logStdErr(`MCP Server part running on STDIN/STDOUT with specific tools.`);
                //updateComponentStatus('mcp', 'OK'); // Status managed by readline now
            })
            .catch(mcpErr => {
                 logStdErr(`FATAL: MCP Server failed to connect:`, mcpErr);
                 const errMsg = mcpErr instanceof Error ? mcpErr.message : String(mcpErr);
                 updateComponentStatus('mcp', `Error: Connect failed - ${errMsg}`);
                 writeNativeMessage({ status: "error", message: `MCP Server failed: ${errMsg}`}).catch(logStdErr);
                 process.exit(1);
            });
    } catch (error) {
         logStdErr(`FATAL: Failed to initialize MCP Server:`, error);
         const errorMsg = error instanceof Error ? error.message : String(error);
         updateComponentStatus('mcp', `Error: Init failed - ${errorMsg}`);
         writeNativeMessage({ status: "error", message: `MCP Server init failed: ${errorMsg}`}).catch(logStdErr);
         process.exit(1);
    }
}

export function getMcpServerInstance(): McpServer | null {
    return mcpServerInstance;
}
*/

// --- Forwarding Logic (Modified for Request/Response) ---
// Interface for parsing (remains the same, but less critical now)
interface ExtensionMessage { command: string; url?: string; args?: any; }

/**
 * Sends a command string to the extension via Native Messaging and waits for a response.
 * @param commandString The raw command string received from the MCP client (readline).
 * @returns A promise that resolves with the extension's response string or rejects on error/timeout.
 */
async function forwardCommandAndWait(commandString: string): Promise<string> {
    if (!commandString || commandString.trim().length === 0) {
         return `[ERROR] Empty command string received.`;
    }
    logStdErr(`[MCP Server] Processing command: \"${commandString}\"`);

    try {
        // Use the function that waits for a response
        const extensionResponse = await sendCommandAndWaitForResponse(commandString); 
        logStdErr(`[MCP Server] Received response from extension: ${JSON.stringify(extensionResponse)}`);
        
        // Return the raw response string from the extension
        // Let the MCP client parse/handle it as needed
        return extensionResponse; 
        
    } catch (interactionError) {
        const errorMessage = interactionError instanceof Error ? interactionError.message : String(interactionError);
        logStdErr(`[MCP Server] Error during interaction with extension for command "${commandString}":`, interactionError);
        // Return a formatted error string for the MCP client
        return `[ERROR] Failed interaction with extension: ${errorMessage}`; 
    }
}
// --- END Forwarding Logic ---

let rl: readline.Interface | null = null;

export function startMcpServer() {
    logStdErr('MCP Server (Readline Forwarder Mode) running on STDIN/STDOUT.');
    updateComponentStatus('mcp', 'OK');

    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false // Important for non-interactive use
    });

    rl.on('line', async (line) => {
        const commandString = line.trim();
        if (!commandString) return; // Ignore empty lines
        logStdErr(`[MCP Server] Received line: \"${commandString}\"`);
        
        let result: string;
        try {
            // Call the updated function that waits
            result = await forwardCommandAndWait(commandString); 
            logStdErr(`[MCP Server] Sending response to stdout: ${result}`);
        } catch (error) {
            // Catch unexpected errors *calling* forwardCommandAndWait, though it should handle internal errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            logStdErr(`[MCP Server] Critical error calling forwardCommandAndWait:`, error);
            result = `[ERROR] ${errorMessage}`;
        }
        // Write the result (either success response or error string) followed by a newline
        process.stdout.write(result + '\n'); 
    });

     rl.on('close', () => {
        logStdErr('[MCP Server] Readline interface closed (stdin ended).');
        updateComponentStatus('mcp', 'Stopped');
        // Use writeNativeMessage for status updates if connection might still exist
        writeNativeMessage({ status: "info", component: "mcp", message: "MCP server stdin closed." }).catch(logStdErr);
      });
      
     rl.on('error', (err) => {
         logStdErr(`[MCP Server] Readline Error:`, err);
         updateComponentStatus('mcp', `Error: Readline ${err.message}`);
         writeNativeMessage({ status: "error", component: "mcp", message: `MCP server readline error: ${err.message}` }).catch(logStdErr);
      });
}

export function stopMcpServer() {
    if (rl) {
        logStdErr('[MCP Server] Closing readline interface...');
        rl.close();
        rl = null; // Important to prevent further operations
        updateComponentStatus('mcp', 'Stopped');
        logStdErr('[MCP Server] Readline interface closed.');
    }
}

// MCP server typically doesn't need an explicit stop method for STDIN/STDOUT transport,
// as it relies on the process exiting. 