import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema'; // Keep for potential future structured results
import { logStdErr } from './utils/logger.js';
import { updateComponentStatus } from './state.js';
import { writeNativeMessage } from './native-messaging.js';
import { SERVER_NAME, SERVER_VERSION } from './config.js';
import { handleCommandString } from './commands.js'; // Import command handler

let mcpServerInstance: McpServer | null = null;

// --- MCP Tool Input Schemas ---

const PingInputSchema = z.object({
    payload: z.string().optional().describe("Optional payload to include in the ping response."),
});

const GetBrowserLogsInputSchema = z.object({}); // No input needed

const GetStatusInputSchema = z.object({}); // No input needed for status

// --- MCP Tool Handlers ---

async function handleMcpPing(args: z.infer<typeof PingInputSchema>): Promise<CallToolResult> {
    let commandString = 'ping';
    if (args.payload) {
        commandString += ` ${args.payload}`;
    }
    logStdErr(`Executing MCP tool 'ping', constructing command string: "${commandString}"`);
    const resultString = await handleCommandString(commandString);
    // Return the raw string result from handleCommandString
    return {
        content: [{ type: "text", text: resultString }],
    };
}

async function handleMcpGetBrowserLogs(args: z.infer<typeof GetBrowserLogsInputSchema>): Promise<CallToolResult> {
    const commandString = 'getBrowserLogs';
    logStdErr(`Executing MCP tool 'getBrowserLogs', constructing command string: "${commandString}"`);
    const resultString = await handleCommandString(commandString);
    // Return the raw string result
    return {
        content: [{ type: "text", text: resultString }],
    };
}

async function handleMcpStatus(args: z.infer<typeof GetStatusInputSchema>): Promise<CallToolResult> {
    const commandString = 'status';
    logStdErr(`Executing MCP tool 'getStatus', constructing command string: "${commandString}"`);
    const resultString = await handleCommandString(commandString);
    // Return the raw string result
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

        // Register the ping tool
        mcpServer.tool(
            "ping",
            "Sends a ping command, optionally with a payload.",
            PingInputSchema.shape,
            handleMcpPing
        );

        // Register the getBrowserLogs tool
        mcpServer.tool(
            "getBrowserLogs",
            "Requests logs from the browser extension.",
            GetBrowserLogsInputSchema.shape,
            handleMcpGetBrowserLogs
        );

        // Register the getStatus tool
        mcpServer.tool(
            "getStatus", // Tool name for MCP
            "Retrieves the current status of the server components.",
            GetStatusInputSchema.shape,
            handleMcpStatus // Use the new handler
        );

        // Connect transport
        const mcpTransport = new StdioServerTransport();
        mcpServer.connect(mcpTransport)
            .then(() => {
                logStdErr(`MCP Server part running on STDIN/STDOUT with specific tools.`);
                updateComponentStatus('mcp', 'OK');
            })
            .catch(mcpErr => {
                 logStdErr(`FATAL: MCP Server failed to connect:`, mcpErr);
                 const errMsg = mcpErr instanceof Error ? mcpErr.message : String(mcpErr);
                 updateComponentStatus('mcp', `Error: Connect failed - ${errMsg}`);
                 writeNativeMessage({ status: "error", message: `MCP Server failed: ${errMsg}`}).catch(logStdErr);
                 process.exit(1); // Exit if MCP connection fails
            });
    } catch (error) {
         logStdErr(`FATAL: Failed to initialize MCP Server:`, error);
         const errorMsg = error instanceof Error ? error.message : String(error);
         updateComponentStatus('mcp', `Error: Init failed - ${errorMsg}`);
         writeNativeMessage({ status: "error", message: `MCP Server init failed: ${errorMsg}`}).catch(logStdErr);
         process.exit(1); // Exit if MCP initialization fails
    }
}

export function getMcpServerInstance(): McpServer | null {
    return mcpServerInstance;
}

// MCP server typically doesn't need an explicit stop method for STDIN/STDOUT transport,
// as it relies on the process exiting. 