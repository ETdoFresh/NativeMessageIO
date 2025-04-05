// Define the name of the native application (must match the native app manifest)
const NATIVE_APP_NAME = "native-message-io-etdofresh";

let nativePort: browser.runtime.Port | null = null;
let connectionStatus = "Disconnected";
let lastError: string | null = null;

// Define expected message structure from native host
interface NativeMessage {
    status?: string; // Example property
    pid?: number;
    received?: any;
    // Add other potential properties if needed
    [key: string]: any; // Allow flexibility
}

function updatePopupStatus() {
    const isConnected = nativePort !== null;
    let statusText = `Status: ${connectionStatus}`; // Use the detailed status
    if (lastError && !isConnected) {
        statusText += ` (Error: ${lastError})`;
    }

    browser.runtime.sendMessage({ command: "statusUpdate", isConnected, statusText }).catch(err => {
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

            if (message.status === "error") {
                console.error(`Received error status from native app: ${message.message}`);
                connectionStatus = "Connection Error"; // Set a specific status
                lastError = message.message || "Unknown error from native host"; // Store the error message
                // Optionally disconnect immediately if an error status means the connection is useless
                // disconnect(); 
            } else if (message.status === "ready") {
                 connectionStatus = "Connected (Ready)"; // More specific status
                 lastError = null;
            } else if (message.status) {
                 // Handle other potential status messages
                 connectionStatus = `Connected (Status: ${message.status})`;
            }
            // Handle other potential message types without a status field if needed

            updatePopupStatus();
        });

        nativePort.onDisconnect.addListener((p) => {
            if (p.error) {
                console.error(`Native port disconnected with error: ${p.error.message}`);
                lastError = p.error.message; // Keep existing error or set new one
                connectionStatus = "Disconnected (Port Error)"; // Slightly different status
            } else {
                console.log("Native port disconnected normally (or due to process exit).");
                // DO NOT clear lastError here. Let it persist until next successful connect.
                connectionStatus = "Disconnected";
            }
            nativePort = null;
            updatePopupStatus(); // Update UI with potentially persistent error
        });

         // Optional: Send an initial message if your native app expects one
         // nativePort.postMessage({ text: "Connection established" });

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
        console.log("Disconnecting native port.");
        nativePort.disconnect();
        nativePort = null; // Assume disconnect is synchronous for status update
        connectionStatus = "Disconnected";
        lastError = null;
        updatePopupStatus();
    } else {
        console.log("Already disconnected.");
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
        return true; // Indicate async response (though we send sync here)
    } else if (message.command === "getStatus") {
        const isConnected = nativePort !== null;
        let statusText = `Status: ${connectionStatus}`;
        if (lastError && !isConnected) {
            statusText += ` (Error: ${lastError})`;
        }
        sendResponse({ isConnected: isConnected, statusText: statusText });
        return true; // Indicate async response
    }
    // Handle other commands if needed
    return false; // Indicate no async response needed for unhandled commands
});

// Remove the old browser action listener
// browser.browserAction.onClicked.addListener(() => { ... });

console.log("Background script loaded for Native Host Control.");
// Optionally attempt to connect on startup?
// connect(); 