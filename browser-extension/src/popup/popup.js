console.log("[Popup] Script top level - waiting for DOMContentLoaded.");

let statusDiv;
let toggleButton;
let iconImage;
let errorMessageDiv;
let componentStatusDiv;
let httpStatusSpan;
let ipcStatusSpan;
let mcpStatusSpan;

document.addEventListener('DOMContentLoaded', () => {
    console.log("[Popup] DOMContentLoaded event fired.");
    statusDiv = document.getElementById('statusText');
    toggleButton = document.getElementById('toggleButton');
    iconImage = document.getElementById('iconImage');
    errorMessageDiv = document.getElementById('errorMessage');
    componentStatusDiv = document.getElementById('componentStatus');
    httpStatusSpan = document.getElementById('httpStatus');
    ipcStatusSpan = document.getElementById('ipcStatus');
    mcpStatusSpan = document.getElementById('mcpStatus');

    console.log(`[Popup] Elements acquired: statusDiv=${!!statusDiv}, toggleButton=${!!toggleButton}, iconImage=${!!iconImage}`);

    if (toggleButton && statusDiv && iconImage && errorMessageDiv && componentStatusDiv && httpStatusSpan && ipcStatusSpan && mcpStatusSpan) {
        updateUI(false, 'Status: Checking...'); // Initial state
        toggleButton.addEventListener('click', handleToggleButtonClick);
        console.log("[Popup] Added toggle button listener.");
    } else {
        console.error("[Popup] Failed to acquire essential UI elements.");
    }
    // Get initial status after setting up listeners
    getInitialStatus();
    console.log("[Popup] DOM Ready. Calling getInitialStatus()...");

});

/** Updates the UI elements based on connection status and component details */
function updateUI(isConnected, statusText, components) {
    console.log(`[Popup:updateUI] Called with isConnected=${isConnected}, statusText=${statusText}`);
    if (!toggleButton || !statusDiv || !iconImage || !errorMessageDiv || !componentStatusDiv || !httpStatusSpan || !ipcStatusSpan || !mcpStatusSpan) {
        console.error("[Popup:updateUI] Missing UI elements.");
        return;
    }

    toggleButton.disabled = false; // Re-enable button by default
    errorMessageDiv.textContent = ''; // Clear previous errors
    componentStatusDiv.style.display = isConnected ? 'block' : 'none'; // Show details only when connected

    if (isConnected) {
        statusDiv.textContent = statusText || 'Status: Connected';
        toggleButton.textContent = 'Disconnect';
        iconImage.src = '/icons/native-host-control-connected-128.png';
        console.log("[Popup:updateUI] Setting state to Connected.");

        // Update component status indicators
        updateComponentStatusSpan(httpStatusSpan, components?.http);
        updateComponentStatusSpan(ipcStatusSpan, components?.ipc);
        updateComponentStatusSpan(mcpStatusSpan, components?.mcp);

    } else {
        statusDiv.textContent = statusText || 'Status: Disconnected';
        toggleButton.textContent = 'Connect';
        iconImage.src = '/icons/native-host-control-128.png';
        console.log("[Popup:updateUI] Setting state to Disconnected.");
        // Reset component status indicators
        updateComponentStatusSpan(httpStatusSpan);
        updateComponentStatusSpan(ipcStatusSpan);
        updateComponentStatusSpan(mcpStatusSpan);
    }
}

/** Helper to update a single component status span */
function updateComponentStatusSpan(span, status) {
    if (!span) return;

    span.classList.remove('status-green', 'status-red', 'status-grey');
    if (status === undefined || status === 'pending') {
        span.textContent = '?';
        span.classList.add('status-grey');
    } else if (status === 'OK') {
        span.textContent = 'OK';
        span.classList.add('status-green');
    } else if (status.startsWith('Error:')) {
        span.textContent = 'Error';
        span.title = status; // Show full error on hover
        span.classList.add('status-red');
    } else {
        span.textContent = status; // Fallback for unexpected values
        span.classList.add('status-grey');
    }
}

/** Handles clicks on the toggle button */
function handleToggleButtonClick() {
    console.log("[Popup] Toggle button clicked.");
    if (toggleButton) {
        toggleButton.disabled = true; // Prevent double-clicks
        console.log("[Popup] Sending toggle command...");
        browser.runtime.sendMessage({ command: "toggle" })
            .then(response => {
                console.log("[Popup] Toggle response received: ", response);
                // Update UI based on initial acknowledgement (connecting/disconnecting)
                if (response.status === 'connecting') {
                    updateUI(false, 'Status: Connecting...');
                } else if (response.status === 'disconnecting') {
                    updateUI(false, 'Status: Disconnecting...');
                }
                // Actual connected/disconnected status will come via separate message
            })
            .catch(error => {
                console.error("[Popup] Error sending toggle message:", error);
                updateUI(false, 'Status: Error');
                if (errorMessageDiv) errorMessageDiv.textContent = `Error: ${error.message}`;
                if (toggleButton) toggleButton.disabled = false; // Re-enable on error
            });
    }
}

/** Sends getStatus command to background script */
function getInitialStatus() {
    console.log("[Popup:getInitialStatus] Entered.");
    // Use setTimeout to ensure this runs after DOM setup and potential initial messages
    setTimeout(() => {
         console.log("[Popup:getInitialStatus] Sending getStatus command...");
         browser.runtime.sendMessage({ command: "getStatus" })
            .then(response => {
                console.log("[Popup:getInitialStatus] Received response: ", response);
                if (response.status === 'connected') {
                    console.log("[Popup:getInitialStatus] Status is connected, calling updateUI.");
                    updateUI(true, 'Status: Connected', response.components);
                } else {
                    console.log("[Popup:getInitialStatus] Status is disconnected, calling updateUI(false).");
                    updateUI(false, 'Status: Disconnected');
                }
            })
            .catch(error => {
                console.error("[Popup:getInitialStatus] Error getting initial status:", error);
                updateUI(false, 'Status: Error');
                if (errorMessageDiv) errorMessageDiv.textContent = `Error getting status: ${error.message}`;
            });
    }, 100); // Small delay
    console.log("[Popup:getInitialStatus] setTimeout scheduled.");
}

// Listen for messages FROM background script
console.log("[Popup] Adding runtime.onMessage listener.");
browser.runtime.onMessage.addListener((message, sender) => {
    console.log("[Popup:onMessage] Received message: ", message);
    if (message.type === "NATIVE_DISCONNECTED" || message.type === "NATIVE_CONNECT_ERROR") {
        console.log("[Popup:onMessage] Handling disconnect/error message.");
        updateUI(false, message.type === "NATIVE_CONNECT_ERROR" ? `Status: Connection Error` : 'Status: Disconnected');
        if (message.error && errorMessageDiv) {
            errorMessageDiv.textContent = `Error: ${message.error}`;
        }
    } else if (message.type === "FROM_NATIVE") {
        // Handle messages *forwarded* from the native host (like the ready signal)
        if (message.payload?.status === 'ready') {
             console.log("[Popup:onMessage] Received forwarded 'ready' message. Updating UI.");
             updateUI(true, 'Status: Connected', message.payload.components);
        }
        // Add handling for other specific forwarded messages if needed
    } else if (message.type === "NATIVE_STATUS_UPDATE") {
        // Handle direct status updates from background script
        console.log("[Popup:onMessage] Received status update. Updating UI.");
        updateUI(message.payload.isConnected, message.payload.isConnected ? 'Status: Connected' : 'Status: Disconnected', message.payload.components);
    }
    // Important: Return true if you intend to send a response asynchronously
    // return true;
});
console.log("[Popup] Added runtime.onMessage listener."); 