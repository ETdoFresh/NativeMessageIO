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
let httpPortDisplay;
let settingsButton;
let settingsPanel;
let apiPortInput;
let apiPortDisplayLocked;
let ipcPipeSettingSpan;
let mcpPortInput;
let mcpPortDisplayLocked;
let saveSettingsButton;
let closeSettingsButton;
let mainPopupContent;

// Hardcoded IPC Pipe Name (matches native host)
// const IPC_PIPE_NAME = process.platform === 'win32' ? '\\\\.\\pipe\\native-message-io-ipc-pipe' : '/tmp/native-message-io-ipc-pipe.sock'; // REMOVED: process is not defined in browser
const IPC_PIPE_DISPLAY_NAME = "native-message-io-ipc-pipe"; // Fixed display name

// Default Ports (used when connected but actual value missing)
const DEFAULT_API_PORT = 3580;
// const DEFAULT_MCP_PORT = 3581; // Example if needed

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
    httpPortDisplay = document.getElementById('httpPortDisplay');
    settingsButton = document.getElementById('settingsButton');
    settingsPanel = document.getElementById('settingsPanel');
    apiPortInput = document.getElementById('apiPortInput');
    apiPortDisplayLocked = document.getElementById('apiPortDisplayLocked');
    ipcPipeSettingSpan = document.getElementById('ipcPipeSetting');
    mcpPortInput = document.getElementById('mcpPortInput');
    mcpPortDisplayLocked = document.getElementById('mcpPortDisplayLocked');
    saveSettingsButton = document.getElementById('saveSettingsButton');
    closeSettingsButton = document.getElementById('closeSettingsButton');
    mainPopupContent = document.querySelector('.popup-container');

    console.log(`[Popup] Elements acquired: statusDiv=${!!statusDiv}, toggleButton=${!!toggleButton}, componentStatusContainer=${!!componentStatusContainer}, httpPortDisplay=${!!httpPortDisplay}`);
    console.log(`[Popup] Settings elements acquired: settingsButton=${!!settingsButton}, settingsPanel=${!!settingsPanel}, apiPortInput=${!!apiPortInput}, apiPortDisplayLocked=${!!apiPortDisplayLocked}, ipcPipeSettingSpan=${!!ipcPipeSettingSpan}, mcpPortInput=${!!mcpPortInput}, mcpPortDisplayLocked=${!!mcpPortDisplayLocked}`);
    console.log(`[Popup] Main content element acquired: ${!!mainPopupContent}`);

    if (toggleButton && statusDiv && iconImage && errorMessageDiv && componentStatusContainer && httpStatusDiv && ipcStatusDiv && mcpStatusDiv && connectedBanner && httpPortDisplay && settingsButton && settingsPanel && apiPortInput && apiPortDisplayLocked && ipcPipeSettingSpan && mcpPortInput && mcpPortDisplayLocked && saveSettingsButton && closeSettingsButton && mainPopupContent) {
        updateUI(false, 'Checking...'); // Initial state
        toggleButton.addEventListener('click', handleToggleButtonClick);
        console.log("[Popup] Added toggle button listener.");
        settingsButton.addEventListener('click', openSettingsPanel);
        saveSettingsButton.addEventListener('click', saveSettings);
        closeSettingsButton.addEventListener('click', closeSettingsPanel);
        console.log("[Popup] Added settings listeners.");
    } else {
        console.error("[Popup] FATAL: Could not find essential UI, Settings, or Main Content elements after DOMContentLoaded!");
        if(document.body) document.body.textContent = "Error: Popup UI elements missing.";
        return;
    }
    getInitialStatus();
    console.log("[Popup] DOM Ready. Calling getInitialStatus()...");
});

/** Updates the UI elements based on connection status and component details */
function updateUI(isConnected, status, components, httpPort) {
    console.log(`[Popup:updateUI] Called with isConnected=${isConnected}, status=${status}, components=`, components, `, httpPort=${httpPort}`);
    if (!toggleButton || !statusDiv || !iconImage || !errorMessageDiv || !componentStatusContainer || !httpStatusDiv || !ipcStatusDiv || !mcpStatusDiv || !connectedBanner || !httpPortDisplay || !settingsButton || !settingsPanel || !apiPortInput || !apiPortDisplayLocked || !ipcPipeSettingSpan || !mcpPortInput || !mcpPortDisplayLocked || !saveSettingsButton || !closeSettingsButton || !mainPopupContent) {
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
    httpPortDisplay.textContent = '';

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

        if (httpPort) {
            httpPortDisplay.textContent = `:${httpPort}`;
        }
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
        if (ipcPipeSettingSpan) ipcPipeSettingSpan.textContent = 'N/A';
        httpPortDisplay.textContent = '';
        console.log(`[Popup:updateUI] Setting state to Disconnected/Error (${status}).`);
    }
}

/** Helper to update a single component status div */
function updateComponentStatusDiv(div, status) {
    if (!div) return;
    const checkSpan = div.querySelector('.status-check'); // Get the span for the checkmark
    if (!checkSpan) return; // Should exist after HTML change

    // Reset classes and checkmark
    div.className = 'component-status'; // Base class
    checkSpan.textContent = ''; // Clear checkmark

    if (status === undefined || status === 'pending') {
        div.classList.add('status-grey');
    } else if (status === 'OK') {
        div.classList.add('status-green');
        checkSpan.textContent = ' ✔️'; // Add checkmark for OK status
    } else if (status.startsWith('Error:')) {
        div.title = status; // Show full error on hover
        div.classList.add('status-red');
        checkSpan.textContent = ' ❌'; // Add an 'x' for errors
    } else {
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
                    updateUI(true, 'Connected', response.components, response.httpPort);
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
    const currentHttpPort = message.payload?.httpPort;

    if (message.type === "NATIVE_DISCONNECTED") {
        console.log("[Popup:onMessage] Handling disconnect message.");
        updateUI(false, 'Disconnected', message.payload?.components);
    } else if (message.type === "NATIVE_CONNECT_ERROR") {
        console.log("[Popup:onMessage] Handling connect error message.");
        const errMsg = `Connect Error: ${message.error || 'Unknown'}`;
        updateUI(false, errMsg, message.payload?.components);
    } else if (message.type === "FROM_NATIVE" && message.payload?.status === 'ready') {
        console.log("[Popup:onMessage] Received forwarded 'ready' message. Updating UI.");
        updateUI(true, 'Connected', message.payload.components, currentHttpPort);
    } else if (message.type === "NATIVE_STATUS_UPDATE") {
        console.log("[Popup:onMessage] Received status update. Updating UI.");
        updateUI(message.payload.isConnected, message.payload.isConnected ? 'Connected' : 'Disconnected', message.payload.components, currentHttpPort);
    }
});
console.log("[Popup] Added runtime.onMessage listener.");

// --- Settings Panel Logic ---

function openSettingsPanel() {
    console.log("[Popup] openSettingsPanel: Attempting to open...");
    if (!settingsPanel || !apiPortInput || !apiPortDisplayLocked || !ipcPipeSettingSpan || !mcpPortInput || !mcpPortDisplayLocked || !mainPopupContent || !connectedBanner || !saveSettingsButton) {
        console.error("[Popup] openSettingsPanel: Missing required elements.");
        return;
    }
    console.log("[Popup] openSettingsPanel: Elements found.");

    // Check connection status by looking at the connected banner's visibility
    const isConnected = connectedBanner.classList.contains('status-visible');
    console.log(`[Popup] openSettingsPanel: Connection status: ${isConnected}`);

    // Get the actual current API port from the main display (if connected)
    const currentActualApiPort = httpPortDisplay.textContent.startsWith(':') ? httpPortDisplay.textContent.substring(1) : null;

    // Display static IPC pipe name
    ipcPipeSettingSpan.textContent = IPC_PIPE_DISPLAY_NAME;

    // Load saved ports from storage (we always need these)
    browser.storage.local.get(['apiPort', 'mcpSsePort']).then(result => {
        const savedApiPort = result.apiPort || '';
        const savedMcpPort = result.mcpSsePort || '';
        console.log(`[Popup] openSettingsPanel: Loaded Saved API Port: ${savedApiPort}, Saved MCP Port: ${savedMcpPort}`);

        if (isConnected) {
            // --- Connected State --- 
            // Display actual ports (or defaults), hide inputs, show spans
            apiPortInput.style.display = 'none';
            mcpPortInput.style.display = 'none';
            apiPortDisplayLocked.style.display = 'inline';
            mcpPortDisplayLocked.style.display = 'inline';

            apiPortDisplayLocked.textContent = currentActualApiPort || DEFAULT_API_PORT;
            // For MCP, display saved value or 'Not Set' since no actual connected port exists yet
            mcpPortDisplayLocked.textContent = savedMcpPort || '(Not Set)';

            saveSettingsButton.disabled = true; // Disable save when connected
            saveSettingsButton.title = "Disconnect to change settings";
        } else {
            // --- Disconnected State --- 
            // Show inputs, hide spans, load saved values into inputs
            apiPortInput.style.display = 'block';
            mcpPortInput.style.display = 'block';
            apiPortDisplayLocked.style.display = 'none';
            mcpPortDisplayLocked.style.display = 'none';

            // Use saved API port, fallback placeholder logic
            apiPortInput.value = savedApiPort;
            if (!apiPortInput.value && currentActualApiPort) {
                apiPortInput.placeholder = currentActualApiPort; // Show just the number
            } else {
                apiPortInput.placeholder = String(DEFAULT_API_PORT); // Show just the default number
            }

            // Load saved MCP Port
            mcpPortInput.value = savedMcpPort;
            mcpPortInput.placeholder = "3581"; // Show just the example number

            saveSettingsButton.disabled = false; // Enable save when disconnected
            saveSettingsButton.title = "";
        }

    }).catch(err => {
        // Error loading storage - default to disconnected view
        console.error("[Popup] openSettingsPanel: Error loading settings from storage:", err);
        apiPortInput.style.display = 'block';
        mcpPortInput.style.display = 'block';
        apiPortDisplayLocked.style.display = 'none';
        mcpPortDisplayLocked.style.display = 'none';
        apiPortInput.value = '';
        apiPortInput.placeholder = String(DEFAULT_API_PORT); // Show just the default number
        mcpPortInput.value = '';
        mcpPortInput.placeholder = "3581"; // Show just the example number
        saveSettingsButton.disabled = false;
        saveSettingsButton.title = "";
    });

    // Toggle visibility using body class
    console.log("[Popup] openSettingsPanel: Adding .settings-active to body.");
    document.body.classList.add('settings-active');
}

function closeSettingsPanel() {
    console.log("[Popup] closeSettingsPanel: Attempting to close...");
    if (!settingsPanel || !mainPopupContent) {
         console.error("[Popup] closeSettingsPanel: Missing required elements.");
         return;
    }
    console.log("[Popup] closeSettingsPanel: Elements found.");

    // Toggle visibility using body class
    console.log("[Popup] closeSettingsPanel: Removing .settings-active from body.");
    document.body.classList.remove('settings-active');
}

function saveSettings() {
    console.log("[Popup] Saving settings...");
    if (!apiPortInput || !mcpPortInput) return;

    const apiPortValue = apiPortInput.value.trim();
    const mcpPortValue = mcpPortInput.value.trim();

    const apiPortNumber = parseInt(apiPortValue, 10);
    const mcpPortNumber = parseInt(mcpPortValue, 10);

    // Validate API Port
    if (apiPortValue !== '' && (isNaN(apiPortNumber) || apiPortNumber < 1 || apiPortNumber > 65535)) {
        alert('Invalid API Server Port. Please enter a number between 1 and 65535, or leave it blank to use default.');
        return;
    }

    // Validate MCP Port
    if (mcpPortValue !== '' && (isNaN(mcpPortNumber) || mcpPortNumber < 1 || mcpPortNumber > 65535)) {
        alert('Invalid MCP SSE Port. Please enter a number between 1 and 65535, or leave it blank.');
        return;
    }

    const settingsToSave = {
        apiPort: apiPortValue === '' ? '' : apiPortNumber,
        mcpSsePort: mcpPortValue === '' ? '' : mcpPortNumber
    };

    // Save the valid port numbers (or empty string if blank)
    browser.storage.local.set(settingsToSave)
        .then(() => {
            console.log(`[Popup] Saved Settings to storage:`, settingsToSave);
            // Optionally show a success message
            closeSettingsPanel(); // Close panel after saving
        })
        .catch(err => {
            console.error("[Popup] Error saving settings to storage:", err);
            alert(`Error saving settings: ${err.message}`);
        });
} 