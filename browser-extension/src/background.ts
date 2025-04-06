// --- Log Buffer ---
const MAX_LOG_MESSAGES = 100;
let consoleLogBuffer: { timestamp: number; message: string }[] = [];

/**
 * Logs a message to both the actual console and an in-memory buffer.
 * Keeps the buffer size limited to MAX_LOG_MESSAGES.
 * @param message The message string to log.
 */
function logToBuffer(message: string): void {
    if (consoleLogBuffer.length >= MAX_LOG_MESSAGES) {
        consoleLogBuffer.shift(); // Remove the oldest message
    }
    const logEntry = { timestamp: Date.now(), message: message };
    consoleLogBuffer.push(logEntry);
    // Also log to the actual browser console for real-time debugging
    console.log(`[Buffered] ${message}`);
}
// --- End Log Buffer ---

// --- Native Host Status Tracking ---
let nativeHostStatus: { isConnected: boolean; components: { [key: string]: string } } = {
    isConnected: false,
    components: {}
};
// --- End Status Tracking ---

const APP_TITLE = "Native Message IO";

// Store icon path (relative to extension root)
const ICON_DEFAULT = "icons/native-host-control-128.png"; // Added definition
const ICON_CONNECTED = "icons/native-host-control-connected-128.png"; // Define connected icon path

// Function to update title
function updateTitle(isConnected: boolean, statusText?: string) {
    const state = isConnected ? "Connected" : (statusText || "Disconnected");
    browser.action.setTitle({ title: `${APP_TITLE} (${state})` }).catch((e: Error) => {
        logToBuffer(`[Background:updateTitle] Error setting title: ${e.message}`);
    });
}

// Define the name of the native application (must match the native app manifest)
const NATIVE_APP_NAME = "native_message_io_etdofresh";

let nativePort: browser.runtime.Port | null = null;
let connectionStatus = "Disconnected";
let lastError: string | null = null;
// Variables to store last known state from 'ready' message
let lastKnownComponents: { [key: string]: string } | undefined = undefined;
let lastKnownHttpPort: number | undefined = undefined;

// Define expected message structure from native host
interface NativeMessage {
    status?: string; // Example property
    pid?: number;
    received?: any;
    // Add other potential properties if needed
    [key: string]: any; // Allow flexibility
}

// Modify updatePopupStatus to accept optional components and httpPort
function updatePopupStatus(components?: { [key: string]: string }, httpPort?: number) {
    const isConnected = nativePort !== null;
    let statusText = `Status: ${connectionStatus}`;
    if (lastError && !isConnected) {
        statusText += ` (Error: ${lastError})`;
    }

    // Change the message format to use 'type' and 'payload'
    const messageToSend = {
        type: "NATIVE_STATUS_UPDATE", // Use the type popup.js expects
        payload: {
            isConnected: isConnected,
            statusText: statusText,
            // Include components and httpPort if provided
            components: components, // Will be undefined if not passed
            httpPort: httpPort     // Will be undefined if not passed
        }
    };

    browser.runtime.sendMessage(messageToSend).catch(err => {
        // Ignore errors if popup is not open
        if (err.message.includes("Could not establish connection")) return;
        console.warn("Error sending status update to popup:", err);
    });
}

function connect() {
    if (nativePort) {
        console.log("Already connected.");
        return;
    }
    console.log(`Connecting to native application: ${NATIVE_APP_NAME}`);
    // Clear previous error state BEFORE attempting connection
    lastError = null;
    connectionStatus = "Connecting...";
    updatePopupStatus(); // Show Connecting status without old error

    try {
        nativePort = browser.runtime.connectNative(NATIVE_APP_NAME);
        connectionStatus = "Connected"; // Assume connected initially, may change on message/disconnect

        nativePort.onMessage.addListener((message: NativeMessage) => {
            console.log(`Received message from native app: ${JSON.stringify(message)}`);

            // --- BEGIN: Handle commands from native host ---
            if (message.command) {
                 console.log(`Handling command from native host: ${message.command}`);
                 try { // Wrap command handling in try/catch
                     switch (message.command) {
                         case 'get_console_logs': {
                             // TODO: Implement logic to get console logs. Requires debugger API or content script.
                             // Example placeholder data:
                             const consoleLogs = [{ level: 'log', message: 'Example log from extension', timestamp: Date.now() }];
                             console.log("Sending 'console_logs' back to native host");
                             nativePort?.postMessage({ status: 'console_logs', logs: consoleLogs });
                             break;
                         }
                         case 'get_console_warnings': {
                             // TODO: Implement logic to get console warnings. Requires debugger API or content script.
                             const consoleWarnings: any[] = [];
                             console.log("Sending 'console_warnings' back to native host");
                             nativePort?.postMessage({ status: 'console_warnings', warnings: consoleWarnings });
                             break;
                         }
                         case 'get_console_errors': {
                             // TODO: Implement logic to get console errors. Requires debugger API or content script.
                             const consoleErrors: any[] = [];
                             console.log("Sending 'console_errors' back to native host");
                             nativePort?.postMessage({ status: 'console_errors', errors: consoleErrors });
                             break;
                         }
                         case 'get_console_all': {
                             // TODO: Implement logic to get all console messages. Requires debugger API or content script.
                             const allConsole = { logs: [{ level: 'log', message: 'Example log', ts: Date.now() }], warnings: [], errors: [] };
                             console.log("Sending 'console_all' back to native host");
                             nativePort?.postMessage({ status: 'console_all', data: allConsole });
                             break;
                         }
                         case 'clear_console': {
                             // TODO: Implement logic to clear the browser console (likely needs debugger API or content script command)
                             // Note: Standard web extension APIs usually can't clear the devtools console directly.
                             // This might involve sending a command to a content script that calls console.clear().
                             console.log("Sending 'console_cleared' confirmation back to native host");
                             nativePort?.postMessage({ status: 'console_cleared' });
                             break;
                         }
                         case 'get_network_errors': {
                             // TODO: Implement logic to get network errors (likely needs webRequest API and storage)
                             // You'll need to listen to webRequest.onErrorOccurred and store the errors.
                             const networkErrors: any[] = [];
                             console.log("Sending 'network_errors' back to native host");
                             nativePort?.postMessage({ status: 'network_errors', errors: networkErrors });
                             break;
                         }
                         case 'get_screenshot': {
                             // Takes a screenshot of the visible tab. Requires "tabs" permission.
                             // Omitting the first argument defaults to the active tab in the current window.
                             browser.tabs.captureVisibleTab({ format: "png" }) // Omitted the first argument (tabId)
                                 .then(dataUrl => {
                                     console.log("Sending 'screenshot_data' back to native host");
                                     nativePort?.postMessage({ status: 'screenshot_data', data: dataUrl });
                                 })
                                 .catch(err => {
                                     console.error("Error taking screenshot:", err);
                                     // Send an error back to the native host
                                     nativePort?.postMessage({ status: 'error', command: 'get_screenshot', message: `Screenshot failed: ${err.message}` });
                                 });
                             // Response is sent asynchronously in the promise above.
                             break;
                         }
                         case 'get_selected_element': {
                             // TODO: Implement logic to get selected element (needs content script interaction)
                             // 1. Send message to active tab's content script requesting selected element.
                             // 2. Content script listens for selection changes or has a way to get current selection.
                             // 3. Content script sends response back to background script.
                             // 4. Background script sends data back to native host.
                             const selectedElementData = null; // Placeholder
                             console.log("Sending 'selected_element_data' back to native host (Placeholder)");
                             nativePort?.postMessage({ status: 'selected_element_data', data: selectedElementData });
                             break;
                         }
                         default:
                             console.warn(`Received unknown command from native host: ${message.command}`);
                             // Optionally send an error back for unknown commands
                             nativePort?.postMessage({ status: 'error', command: message.command, message: `Unknown command: ${message.command}` });
                     }
                 } catch (cmdError) {
                     console.error(`Error handling command '${message.command}':`, cmdError);
                     // Send a generic error back if command handling fails unexpectedly
                      nativePort?.postMessage({ status: 'error', command: message.command, message: `Error processing command: ${cmdError instanceof Error ? cmdError.message : String(cmdError)}` });
                 }
            }
            // --- END: Handle commands from native host ---

            // --- BEGIN: Handle status messages from native host ---
            else if (message.status === "error") {
                console.error(`Received error status from native app: ${message.message}`);
                connectionStatus = "Connection Error"; // Set a specific status
                lastError = message.message || "Unknown error from native host"; // Store the error message
                updatePopupStatus(); // Send basic status update
                // Optionally disconnect immediately if an error status means the connection is useless
                // disconnect();
            } else if (message.status === "ready") {
                 connectionStatus = "Connected (Ready)"; // More specific status
                 lastError = null;
                 // *** Store components and httpPort when 'ready' is received ***
                 lastKnownComponents = message.components;
                 lastKnownHttpPort = message.httpPort;
                 // *** Pass components and httpPort when sending the 'ready' status update ***
                 updatePopupStatus(lastKnownComponents, lastKnownHttpPort);
                 // *** Set connected icon ***
                 browser.action.setIcon({ path: ICON_CONNECTED }).catch((e: Error) => logToBuffer(`Set icon error on ready: ${e.message}`));
            } else if (message.status) {
                 // Handle other potential status messages
                 connectionStatus = `Connected (Status: ${message.status})`;
                 updatePopupStatus(); // Send basic status update
            }
            // --- END: Handle status messages from native host ---

            // Handle other potential message types without a status field if needed
            else {
                 // If it wasn't a command and wasn't a known status, update with basic info
                 updatePopupStatus();
            }

            // updatePopupStatus(); // REMOVED: Moved into specific handler cases above
        });

        console.log("Native port connected.");

    } catch (error) {
        console.error("Failed to connect native port:", error);
        lastError = error instanceof Error ? error.message : String(error);
        connectionStatus = "Failed to connect";
        nativePort = null; // Ensure port is null on failure
    }
    updatePopupStatus();
}

function disconnect() {
    if (nativePort) {
        console.log("[Background:disconnect Function] Attempting to disconnect native port."); // Log entry
        try {
            nativePort.disconnect();
            console.log("[Background:disconnect Function] nativePort.disconnect() called successfully."); // Log success
            
            // --- Perform cleanup IMMEDIATELY after successful disconnect call --- 
            nativePort = null;
            lastKnownComponents = undefined;
            lastKnownHttpPort = undefined;
            connectionStatus = "Disconnected"; // Set to normal disconnected
            lastError = null; // Clear last error on successful disconnect
            console.log("[Background:disconnect Function] Setting icon to default.");
            browser.action.setIcon({ path: ICON_DEFAULT }).catch((err: Error) => {
                console.error(`[Background:disconnect Function] Set icon error after disconnect: ${err.message}`);
            });
            console.log("[Background:disconnect Function] Calling updatePopupStatus.");
            updatePopupStatus(); // Force UI update
            console.log("[Background:disconnect Function] Cleanup finished.");
            // --- End Immediate Cleanup ---

        } catch (e) {
             console.error("[Background:disconnect Function] Error calling nativePort.disconnect():", e);
             // If disconnect throws, the listener might not fire. Manually trigger cleanup.
             nativePort = null;
             lastKnownComponents = undefined;
             lastKnownHttpPort = undefined;
             connectionStatus = "Disconnected (Disconnect Error)";
             lastError = e instanceof Error ? e.message : String(e);
             browser.action.setIcon({ path: ICON_DEFAULT }).catch((err: Error) => {
                 console.error(`[Background:disconnect Function] Set icon error after disconnect error: ${err.message}`);
             });
             updatePopupStatus(); // Force UI update
        }
        // The onDisconnect listener should ideally handle the rest. // REMOVED Listener
    } else {
        console.log("[Background:disconnect Function] Already disconnected.");
    }
}

// Listener for messages from the popup or other extension parts
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received message:", message);
    if (message.command === "toggle") {
        if (nativePort) {
            disconnect();
        } else {
            connect();
        }
        // Respond with the *intended* state after toggle
        const isConnected = nativePort !== null;
        let statusText = `Status: ${connectionStatus}`;
         if (lastError && !isConnected) {
            statusText += ` (Error: ${lastError})`;
        }
        sendResponse({ isConnected: isConnected, statusText: statusText });
        return true; // Indicate async response
    } else if (message.command === "getStatus") {
        const isConnected = nativePort !== null;
        let statusText = `Status: ${connectionStatus}`;
        if (lastError && !isConnected) {
            statusText += ` (Error: ${lastError})`;
        }
        // Send back the stored state
        console.log(`[Background:getStatus] Responding with stored state: isConnected=${isConnected}, components=${JSON.stringify(lastKnownComponents)}, port=${lastKnownHttpPort}`);
        sendResponse({ 
            isConnected: isConnected, 
            statusText: statusText, 
            components: lastKnownComponents, // Use stored value
            httpPort: lastKnownHttpPort      // Use stored value
        });
        return false; // No async response needed anymore
    }
    // Handle other commands if needed
    return false; // Indicate no async response needed for unhandled commands
});

// Remove the old browser action listener
// browser.browserAction.onClicked.addListener(() => { ... });

console.log("Background script loaded for Native Host Control.");
// Optionally attempt to connect on startup?
// connect();

// Ensure the icon is default when the script starts
logToBuffer("[Background] Attaching runtime.onStartup listener..."); // Use buffered log
browser.runtime.onStartup.addListener(() => {
  logToBuffer("[Background:onStartup] Listener triggered. Setting icon & title..."); // Use buffered log
  browser.action.setIcon({ path: ICON_DEFAULT }).catch((e: Error) => logToBuffer(`onStartup setIcon error: ${e.message}`)); // Use buffered log
  updateTitle(false); // Set default title
  logToBuffer("[Background:onStartup] Icon & title set."); // Use buffered log
});
logToBuffer("[Background] Attached runtime.onStartup listener."); // Use buffered log

logToBuffer("[Background] Attaching runtime.onInstalled listener..."); // Use buffered log
browser.runtime.onInstalled.addListener(() => {
  logToBuffer("[Background:onInstalled] Listener triggered. Setting icon & title..."); // Use buffered log
  browser.action.setIcon({ path: ICON_DEFAULT }).catch((e: Error) => logToBuffer(`onInstalled setIcon error: ${e.message}`)); // Use buffered log
  updateTitle(false); // Set default title
  logToBuffer("[Background:onInstalled] Icon & title set."); // Use buffered log
});
logToBuffer("[Background] Attached runtime.onInstalled listener."); // Use buffered log

// Set initial title just in case startup/installed don't fire immediately
updateTitle(false);

logToBuffer("[Background] Initial connection attempt is DISABLED."); // Use buffered log
logToBuffer("[Background] Script bottom level reached."); // Use buffered log 