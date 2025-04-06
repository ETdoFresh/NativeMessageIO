console.log("[Popup] Script top level - waiting for DOMContentLoaded.");

let statusDiv;
let toggleButton;
let iconImage;
let errorMessageDiv;
let componentStatusContainer;
let httpStatusDiv;
let ipcStatusDiv;
let mcpStatusDiv;
let connectedBanner;

document.addEventListener('DOMContentLoaded', () => {
    console.log("[Popup] DOMContentLoaded event fired.");
    statusDiv = document.getElementById('statusText');
    toggleButton = document.getElementById('toggleButton');
    iconImage = document.getElementById('iconImage');
    errorMessageDiv = document.getElementById('errorMessage');
    componentStatusContainer = document.getElementById('componentStatusContainer');
    httpStatusDiv = document.getElementById('httpStatus');
    ipcStatusDiv = document.getElementById('ipcStatus');
    mcpStatusDiv = document.getElementById('mcpStatus');
    connectedBanner = document.getElementById('connectedBanner');

    console.log(`[Popup] Elements acquired: statusDiv=${!!statusDiv}, toggleButton=${!!toggleButton}, componentStatusContainer=${!!componentStatusContainer}`);

    if (toggleButton && statusDiv && iconImage && errorMessageDiv && componentStatusContainer && httpStatusDiv && ipcStatusDiv && mcpStatusDiv && connectedBanner) {
        updateUI(false, 'Checking...'); // Initial state
        toggleButton.addEventListener('click', handleToggleButtonClick);
        console.log("[Popup] Added toggle button listener.");
    } else {
        console.error("[Popup] FATAL: Could not find essential UI elements after DOMContentLoaded!");
        if(document.body) document.body.textContent = "Error: Popup UI elements missing.";
        return;
    }
    getInitialStatus();
    console.log("[Popup] DOM Ready. Calling getInitialStatus()...");
});

/** Updates the UI elements based on connection status and component details */
function updateUI(isConnected, status, components) {
    console.log(`[Popup:updateUI] Called with isConnected=${isConnected}, status=${status}, components=`, components);
    if (!toggleButton || !statusDiv || !iconImage || !errorMessageDiv || !componentStatusContainer || !httpStatusDiv || !ipcStatusDiv || !mcpStatusDiv || !connectedBanner) {
        console.error("[Popup:updateUI] Missing UI elements.");
        return;
    }

    // --- Reset states ---
    toggleButton.disabled = false;
    errorMessageDiv.textContent = '';
    statusDiv.textContent = status;
    statusDiv.className = 'status-text'; // Reset classes
    toggleButton.className = 'button'; // Reset classes
    componentStatusContainer.classList.add('status-hidden');
    componentStatusContainer.classList.remove('status-visible');
    connectedBanner.classList.add('status-hidden');
    connectedBanner.classList.remove('status-visible');
    updateComponentStatusDiv(httpStatusDiv);
    updateComponentStatusDiv(ipcStatusDiv);
    updateComponentStatusDiv(mcpStatusDiv);

    // --- Apply new states ---
    if (isConnected) {
        statusDiv.style.display = 'none'; // Hide general status text when connected
        connectedBanner.classList.remove('status-hidden');
        connectedBanner.classList.add('status-visible');
        componentStatusContainer.classList.remove('status-hidden');
        componentStatusContainer.classList.add('status-visible');
        toggleButton.textContent = 'Disconnect';
        toggleButton.classList.add('status-red'); // Disconnect is red
        iconImage.src = '/icons/native-host-control-connected-128.png';
        console.log("[Popup:updateUI] Setting state to Connected.");

        // Update component status indicators
        updateComponentStatusDiv(httpStatusDiv, components?.http);
        updateComponentStatusDiv(ipcStatusDiv, components?.ipc);
        updateComponentStatusDiv(mcpStatusDiv, components?.mcp);

    } else {
        statusDiv.style.display = 'block'; // Show general status text when disconnected
        connectedBanner.classList.add('status-hidden');
        connectedBanner.classList.remove('status-visible');
        componentStatusContainer.classList.add('status-hidden');
        componentStatusContainer.classList.remove('status-visible');
        iconImage.src = '/icons/native-host-control-128.png';

        if (status === 'Disconnected') {
            statusDiv.textContent = 'Disconnected';
            statusDiv.classList.add('status-grey');
            toggleButton.textContent = 'Connect';
            toggleButton.classList.add('status-green'); // Connect is green
        } else if (status === 'Connecting...' || status === 'Checking...' || status === 'Disconnecting...') {
            statusDiv.textContent = status;
            statusDiv.classList.add('status-yellow');
            toggleButton.textContent = status; // Show status in button
            toggleButton.classList.add('status-yellow');
            toggleButton.disabled = true;
        } else { // Error states
            statusDiv.textContent = 'Error';
            statusDiv.classList.add('status-red');
            toggleButton.textContent = 'Connect'; // Allow retry
            toggleButton.classList.add('status-green');
            if(status) errorMessageDiv.textContent = status;
        }
        console.log(`[Popup:updateUI] Setting state to Disconnected/Error (${status}).`);
    }
}

/** Helper to update a single component status div */
function updateComponentStatusDiv(div, status) {
    if (!div) return;
    // const indicator = div.querySelector('.indicator'); // No longer needed
    // if (!indicator) return;

    // Reset classes
    div.className = 'component-status'; // Base class

    if (status === undefined || status === 'pending') {
        // indicator.textContent = '?'; // No text needed
        div.classList.add('status-grey');
    } else if (status === 'OK') {
        // indicator.textContent = 'OK'; // No text needed
        div.classList.add('status-green');
    } else if (status.startsWith('Error:')) {
        // indicator.textContent = 'Error'; // No text needed
        div.title = status; // Show full error on hover
        div.classList.add('status-red');
    } else {
        // indicator.textContent = status; // No text needed
        div.classList.add('status-grey');
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
                if (response.status === 'connecting') {
                    updateUI(false, 'Connecting...');
                } else if (response.status === 'disconnecting') {
                    updateUI(false, 'Disconnected');
                }
            })
            .catch(error => {
                const errMsg = `Toggle Error: ${error.message}`;
                console.error("[Popup] Error sending toggle message:", error);
                updateUI(false, errMsg);
                if (toggleButton) toggleButton.disabled = false;
            });
    }
}

/** Sends getStatus command to background script */
function getInitialStatus() {
    console.log("[Popup:getInitialStatus] Entered.");
    setTimeout(() => {
         console.log("[Popup:getInitialStatus] Sending getStatus command...");
         browser.runtime.sendMessage({ command: "getStatus" })
            .then(response => {
                console.log("[Popup:getInitialStatus] Received response: ", response);
                if (response.status === 'connected') {
                    console.log("[Popup:getInitialStatus] Status is connected, calling updateUI.");
                    updateUI(true, 'Connected', response.components);
                } else {
                    console.log("[Popup:getInitialStatus] Status is disconnected, calling updateUI(false).");
                    updateUI(false, 'Disconnected');
                }
            })
            .catch(error => {
                const errMsg = `Get Status Error: ${error.message}`;
                console.error("[Popup:getInitialStatus] Error getting initial status:", error);
                updateUI(false, errMsg);
            });
    }, 100);
    console.log("[Popup:getInitialStatus] setTimeout scheduled.");
}

// Listen for messages FROM background script
console.log("[Popup] Adding runtime.onMessage listener.");
browser.runtime.onMessage.addListener((message, sender) => {
    console.log("[Popup:onMessage] Received message: ", message);
    if (message.type === "NATIVE_DISCONNECTED") {
        console.log("[Popup:onMessage] Handling disconnect message.");
        updateUI(false, 'Disconnected', message.payload?.components);
    } else if (message.type === "NATIVE_CONNECT_ERROR") {
        console.log("[Popup:onMessage] Handling connect error message.");
        const errMsg = `Connect Error: ${message.error || 'Unknown'}`;
        updateUI(false, errMsg, message.payload?.components);
    } else if (message.type === "FROM_NATIVE" && message.payload?.status === 'ready') {
        // Handle the initial 'ready' signal forwarded from native host
         console.log("[Popup:onMessage] Received forwarded 'ready' message. Updating UI.");
         updateUI(true, 'Connected', message.payload.components);
    } else if (message.type === "NATIVE_STATUS_UPDATE") {
        // Handle subsequent status updates directly from background
        console.log("[Popup:onMessage] Received status update. Updating UI.");
        updateUI(message.payload.isConnected, message.payload.isConnected ? 'Connected' : 'Disconnected', message.payload.components);
    }
});
console.log("[Popup] Added runtime.onMessage listener."); 