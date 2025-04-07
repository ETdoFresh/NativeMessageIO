// browser-extension/src/background.ts
import { executeCommand } from './commands.js';
import { logToBuffer } from './shared-state.js';

// Define the expected structure for commands from popup/other sources
interface CommandMessage {
    command: string;
    [key: string]: any; // Allow arbitrary properties for command arguments
}

// Define the structure for component status (can be shared)
interface ComponentStatus { // Re-enabled
    http?: string;
    ipc?: string;
    mcp?: string;
    nativeMessaging?: string; // Added as native host sends this
}

// --- Constants ---
const NATIVE_HOST_NAME = "native_message_io_etdofresh";

// --- Global State ---
let isConnected: boolean = false;
let componentStatus: ComponentStatus | undefined = undefined; // Re-enabled
let httpPort: number | undefined = undefined; // Re-enabled

// Simple log function wrapper
function log(message: string): void {
    console.log(message); // Log to background console
    logToBuffer(message); // Also send to shared buffer for potential popup display
}

log("[Background] Script loading...");

// ---- Native Messaging Port Management ----
let nativePort: browser.runtime.Port | null = null;

function connectNative(): void {
    if (nativePort) {
        log("[Background] connectNative: Already connected or connecting.");
        return; // Avoid multiple connections
    }
    log(`[Background] Connecting to native application: ${NATIVE_HOST_NAME}`);
    sendPopupUpdate(false, "Status: Connecting..."); // Update popup early
    try {
        nativePort = browser.runtime.connectNative(NATIVE_HOST_NAME);
        log("[Background] Native port connection initiated.");

        nativePort.onMessage.addListener(onNativeMessage);
        nativePort.onDisconnect.addListener(onNativeDisconnect);
        log("[Background] onDisconnect listener ATTACHED.");

    } catch (error) {
        log(`[Background] Error connecting to native application: ${error instanceof Error ? error.message : String(error)}`);
        nativePort = null; // Ensure port is null on error
        sendPopupUpdate(false, `Status: Error - ${error instanceof Error ? error.message : String(error)}`);
    }
}

function disconnectNative(): void {
    log('[Background] disconnectNative called.');
    if (nativePort) {
        log('[Background] Disconnecting native port...');
        try {
            nativePort.disconnect();
            log('[Background] nativePort.disconnect() called.');
        } catch (e) {
            // Log error if disconnect fails, though it might be expected if already closed
            log(`[Background] Error calling nativePort.disconnect(): ${e instanceof Error ? e.message : String(e)}`);
        }

        // --- Immediate Cleanup and UI Update (since onDisconnect might not fire reliably) ---
        log('[Background] Performing immediate cleanup after disconnect call...');
        nativePort = null; // Clean up the reference immediately
        isConnected = false;
        componentStatus = undefined; // Reset state
        httpPort = undefined; // Reset state
        sendPopupUpdate(false, "Status: Disconnected");
        log('[Background] Immediate cleanup and UI update complete.');
        // --------------------------------------------------------------------------------

    } else {
        log('[Background] disconnectNative: No active connection found.');
        // Ensure UI is updated even if port was already null/disconnected previously
        if (!isConnected) { // Only send update if not already marked as disconnected
             sendPopupUpdate(false, "Status: Disconnected");
        }
    }
}

// --- Native Message Handlers ---

function onNativeMessage(message: any): void {
    log(`[Background] Received message: ${JSON.stringify(message)}`);

    if (message && message.status === 'ready') {
        log("[Background] Received 'ready' signal from native host.");
        isConnected = true;
        // Safely assign components and port to global state
        componentStatus = message.components || {}; // Ensure it's an object
        httpPort = message.httpPort; // Assign port
        log(`[Background] Stored state: Components: ${JSON.stringify(componentStatus)}, HTTP Port: ${httpPort}`);
        // Send full update using stored state
        sendPopupUpdate(true, "Status: Connected", componentStatus, httpPort);

    } else if (message && message.type === 'commandWithResponse' && typeof message.requestId === 'string' && typeof message.payload === 'string') {
        log(`[Background] Received commandWithResponse (ID: ${message.requestId}): ${message.payload}`);
        const { command, args, url } = parseCommandString(message.payload); // Parse payload
        if (command) {
            const commandMessage = { command, args, url }; // Construct CommandMessage
             // Execute command, passing the requestId
             executeCommand(commandMessage, nativePort, message.requestId)
                 .catch(err => {
                     log(`[Background] Uncaught error executing commandWithResponse handler for '${command}': ${err instanceof Error ? err.message : String(err)}`);
                     // Attempt to send an error back via the request ID if possible
                     if (nativePort && message.requestId) {
                          try {
                              nativePort.postMessage({ type: 'commandError', requestId: message.requestId, error: `Critical error processing command: ${err instanceof Error ? err.message : String(err)}` });
                          } catch (sendErr) {
                              log(`[Background] Failed to send critical error response for ${message.requestId}: ${sendErr}`);
                          }
                     }
                 });
        } else {
            log(`[Background] Failed to parse command from commandWithResponse payload: ${message.payload}`);
            // Send error back if possible
            if (nativePort && message.requestId) {
                 try {
                     nativePort.postMessage({ type: 'commandError', requestId: message.requestId, error: `Failed to parse command payload: ${message.payload}` });
                 } catch (sendErr) {
                     log(`[Background] Failed to send parse error response for ${message.requestId}: ${sendErr}`);
                 }
            }
        }

    } else if (message && message.status) {
        log(`[Background] Received status update or command result: ${message.status}`);
        // Forward known simple results/errors to popup
        if (message.status === 'error') {
             browser.runtime.sendMessage({ type: 'NATIVE_ERROR', payload: message })
                 .catch(err => log(`[Background] Error sending NATIVE_ERROR to popup: ${err.message}`));
        } else if (message.status.startsWith('console_') || message.status === 'screenshot_data' || message.status === 'console_cleared' || message.status === 'tab_created') {
             const messageType = message.status.startsWith('console_') || message.status === 'console_cleared' ? 'CONSOLE_RESULT' : 'NATIVE_DATA';
             browser.runtime.sendMessage({ type: messageType, payload: message })
                 .catch(err => log(`[Background] Error sending ${messageType} to popup: ${err.message}`));
        } else {
             // Log other statuses, maybe forward if known safe?
              log(`[Background] Received unforwarded status '${message.status}' from native host.`);
        }

    } else {
        log(`[Background] Received unknown/unstructured message: ${JSON.stringify(message)}`);
    }
}

function onNativeDisconnect(port: browser.runtime.Port): void {
    log("!!!!!! [Background] onNativeDisconnect ENTERED !!!!!!");

    // Check if cleanup was already done by disconnectNative()
    if (nativePort === null && !isConnected) {
        log('[Background] onNativeDisconnect: Cleanup already performed by disconnectNative. Skipping.');
        return;
    }

    log(`[Background] Native port disconnected unexpectedly or with delay.`);
    if (port.error) {
        log(`[Background] Disconnect reason: ${port.error.message}`);
    }
    nativePort = null; // Ensure null
    isConnected = false;
    componentStatus = undefined; // Reset state
    httpPort = undefined; // Reset state
    const statusText = port.error ? `Status: Error - ${port.error.message}` : "Status: Disconnected (Unexpected)";
    sendPopupUpdate(false, statusText);
    log("[Background] onNativeDisconnect completed (unexpected disconnect path).");
}


// --- Runtime Message Listener (from Popup/Commands) ---

function handleRuntimeMessage(message: CommandMessage, sender: browser.runtime.MessageSender): void | Promise<any> {
    log(`[Background] Received runtime message: ${JSON.stringify(message)}`);

    switch (message.command) {
        case 'toggle':
            if (isConnected) {
                disconnectNative();
                return Promise.resolve({ status: 'disconnect_request_sent' });
            } else {
                connectNative();
                return Promise.resolve({ status: 'connect_request_sent' });
            }
        case 'getStatus':
            // Return the full current status for the popup
            return Promise.resolve({
                isConnected: isConnected,
                statusText: isConnected ? "Status: Connected" : (nativePort ? "Status: Connecting..." : "Status: Disconnected"),
                components: componentStatus, // Include components
                httpPort: httpPort // Include port
            });
        // Delegate other commands to the command executor
        default:
            if (nativePort) {
                 log(`[Background] Attempting command '${message.command}' via native host.`);
                 executeCommand(message, nativePort)
                     .then(() => {
                         log(`[Background] Command '${message.command}' execution attempted.`);
                     })
                     .catch(err => {
                         log(`[Background] Error executing command '${message.command}': ${err.message}`);
                         const simplifiedError = { status: 'error', command: message.command, message: err instanceof Error ? err.message : String(err) };
                         if (sender.tab?.id) {
                            browser.tabs.sendMessage(sender.tab.id, { type: 'NATIVE_ERROR', payload: simplifiedError })
                                .catch(e => log(`[Background] Failed to send NATIVE_ERROR to calling tab: ${e.message}`));
                         } else {
                            browser.runtime.sendMessage({ type: 'NATIVE_ERROR', payload: simplifiedError })
                                .catch(e => log(`[Background] Failed to send NATIVE_ERROR to popup/runtime: ${e.message}`));
                         }
                     });
                 // Async response is handled by executeCommand sending messages
            } else {
                log(`[Background] Command '${message.command}' received but native host not connected.`);
                return Promise.resolve({ status: 'error', command: message.command, message: 'Native host not connected.' });
            }
            break; // Added break for clarity, though default case ends function flow here
    }
}

// --- Utilities ---

/** Parses the command string from native host payload */
function parseCommandString(payload: string): { command: string | null, args: string | undefined, url: string | undefined } {
    const parts = payload.trim().split(/\s+/); // Split by whitespace
    const command = parts.shift() || null; // First part is the command
    let args: string | undefined = undefined;
    let url: string | undefined = undefined;

    if (parts.length > 0) {
        args = parts.join(' '); // Rejoin remaining parts as arguments string
        // Special handling for create_tab to extract URL
        if (command === 'create_tab') {
            // Basic check if the first argument looks like a URL
            if (parts[0].match(/^(https?|file|ftp):\/\//i) || parts[0].startsWith('about:')) {
                url = parts[0];
            } else {
                log(`[Background:parseCommandString] Warning: 'create_tab' command received, but argument '${parts[0]}' doesn't look like a standard URL.`);
                // Attempt to use it anyway, handler might validate further
                url = parts[0];
            }
        }
    }
    log(`[Background:parseCommandString] Parsed: command=${command}, args=${args}, url=${url}`);
    return { command, args, url };
}

/** Sends status updates to the popup, carefully constructing the payload */
function sendPopupUpdate(connected: boolean, status: string, currentComponents?: ComponentStatus, currentPort?: number): void {
    isConnected = connected; // Update global state
    componentStatus = currentComponents; // Update global state
    httpPort = currentPort; // Update global state

    // Construct a PLAIN payload object to avoid clone errors
    const payload: { isConnected: boolean; statusText: string; components?: ComponentStatus; httpPort?: number } = {
        isConnected: connected,
        statusText: status
    };
    // Only include components and port if they are defined
    if (currentComponents) {
        payload.components = { ...currentComponents }; // Shallow clone to ensure plain object
    }
    if (currentPort !== undefined) {
        payload.httpPort = currentPort;
    }

    log(`[Background] Sending NATIVE_STATUS_UPDATE to popup: ${JSON.stringify(payload)}`);
    try {
         browser.runtime.sendMessage({ type: 'NATIVE_STATUS_UPDATE', payload })
             .catch(err => {
                 if (err.message.includes('Could not establish connection') || err.message.includes('Receiving end does not exist')) {
                     // log("[Background] Popup not open, ignoring sendMessage error.");
                 } else {
                     log(`[Background] Error sending status update to popup: ${err.message}`);
                 }
             });
    } catch(cloneError) {
         const errorMessage = cloneError instanceof Error ? cloneError.message : String(cloneError);
         log(`[Background] !!! DataCloneError caught in sendPopupUpdate: ${errorMessage}. Payload was: ${JSON.stringify(payload)}`);
         // Send simplified error message to popup
         browser.runtime.sendMessage({ type: 'NATIVE_STATUS_UPDATE', payload: { isConnected: isConnected, statusText: `Error: Clone Failed (${status})`, components: undefined, httpPort: undefined } })
              .catch(err => log(`[Background] Error sending fallback status update: ${err.message}`));
    }
}

// --- Initialization ---

browser.runtime.onMessage.addListener(handleRuntimeMessage);
log("[Background] Runtime message listener added.");
log("[Background] Script initialized.");