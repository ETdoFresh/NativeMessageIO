// Removed import for browser-polyfill.js as it should be globally available

console.log("[Popup] Script top level - waiting for DOMContentLoaded.");

// --- Interfaces ---
interface ComponentStatus {
    http?: string; // e.g., 'OK', 'Error: ...', 'pending'
    ipc?: string;
    mcp?: string;
}

interface PopupMessagePayload {
    isConnected?: boolean;
    statusText?: string;
    components?: ComponentStatus;
    httpPort?: number | string | null;
    status?: string; // For 'ready' message from native
    error?: string; // For error messages
}

interface BackgroundMessage {
    command?: 'toggle' | 'getStatus';
    type?: 'NATIVE_DISCONNECTED' | 'NATIVE_CONNECT_ERROR' | 'FROM_NATIVE' | 'NATIVE_STATUS_UPDATE';
    payload?: PopupMessagePayload;
    error?: string; // Used directly in NATIVE_CONNECT_ERROR
}

interface Settings {
    apiPort?: number | ''; // Allow empty string to represent 'use default'
    mcpSsePort?: number | '';
}


// --- DOM Element Variables ---
let statusDiv: HTMLDivElement | null;
let toggleButton: HTMLButtonElement | null;
let iconImage: HTMLImageElement | null;
let errorMessageDiv: HTMLDivElement | null;
let componentStatusContainer: HTMLDivElement | null;
let httpStatusDiv: HTMLDivElement | null;
let ipcStatusDiv: HTMLDivElement | null;
let mcpStatusDiv: HTMLDivElement | null;
let connectedBanner: HTMLDivElement | null;
let httpPortDisplay: HTMLSpanElement | null; // Assuming it's a span
let settingsButton: HTMLButtonElement | null;
let settingsPanel: HTMLDivElement | null;
let apiPortInput: HTMLInputElement | null;
let apiPortDisplayLocked: HTMLSpanElement | null; // Assuming it's a span
let ipcPipeSettingSpan: HTMLSpanElement | null; // Assuming it's a span
let mcpPortInput: HTMLInputElement | null;
let mcpPortDisplayLocked: HTMLSpanElement | null; // Assuming it's a span
let saveSettingsButton: HTMLButtonElement | null;
let closeSettingsButton: HTMLButtonElement | null;
let mainPopupContent: HTMLDivElement | null; // Assuming it's a div

// Hardcoded IPC Pipe Name (matches native host)
// const IPC_PIPE_NAME = process.platform === 'win32' ? '\\\\.\\pipe\\native-message-io-ipc-pipe' : '/tmp/native-message-io-ipc-pipe.sock'; // REMOVED: process is not defined in browser
const IPC_PIPE_DISPLAY_NAME = "native-message-io-ipc-pipe"; // Fixed display name

// Default Ports (used when connected but actual value missing)
const DEFAULT_API_PORT = 3580;
// const DEFAULT_MCP_PORT = 3581; // Example if needed

document.addEventListener('DOMContentLoaded', () => {
    console.log("[Popup] DOMContentLoaded event fired.");
    statusDiv = document.getElementById('statusText') as HTMLDivElement | null;
    toggleButton = document.getElementById('toggleButton') as HTMLButtonElement | null;
    iconImage = document.getElementById('iconImage') as HTMLImageElement | null;
    errorMessageDiv = document.getElementById('errorMessage') as HTMLDivElement | null;
    componentStatusContainer = document.getElementById('componentStatusContainer') as HTMLDivElement | null;
    httpStatusDiv = document.getElementById('httpStatus') as HTMLDivElement | null;
    ipcStatusDiv = document.getElementById('ipcStatus') as HTMLDivElement | null;
    mcpStatusDiv = document.getElementById('mcpStatus') as HTMLDivElement | null;
    connectedBanner = document.getElementById('connectedBanner') as HTMLDivElement | null;
    httpPortDisplay = document.getElementById('httpPortDisplay') as HTMLSpanElement | null;
    settingsButton = document.getElementById('settingsButton') as HTMLButtonElement | null;
    settingsPanel = document.getElementById('settingsPanel') as HTMLDivElement | null;
    apiPortInput = document.getElementById('apiPortInput') as HTMLInputElement | null;
    apiPortDisplayLocked = document.getElementById('apiPortDisplayLocked') as HTMLSpanElement | null;
    ipcPipeSettingSpan = document.getElementById('ipcPipeSetting') as HTMLSpanElement | null;
    mcpPortInput = document.getElementById('mcpPortInput') as HTMLInputElement | null;
    mcpPortDisplayLocked = document.getElementById('mcpPortDisplayLocked') as HTMLSpanElement | null;
    saveSettingsButton = document.getElementById('saveSettingsButton') as HTMLButtonElement | null;
    closeSettingsButton = document.getElementById('closeSettingsButton') as HTMLButtonElement | null;
    mainPopupContent = document.querySelector('.popup-container') as HTMLDivElement | null;

    console.log(`[Popup] Elements acquired: statusDiv=${!!statusDiv}, toggleButton=${!!toggleButton}, componentStatusContainer=${!!componentStatusContainer}, httpPortDisplay=${!!httpPortDisplay}`);
    console.log(`[Popup] Settings elements acquired: settingsButton=${!!settingsButton}, settingsPanel=${!!settingsPanel}, apiPortInput=${!!apiPortInput}, apiPortDisplayLocked=${!!apiPortDisplayLocked}, ipcPipeSettingSpan=${!!ipcPipeSettingSpan}, mcpPortInput=${!!mcpPortInput}, mcpPortDisplayLocked=${!!mcpPortDisplayLocked}`);
    console.log(`[Popup] Main content element acquired: ${!!mainPopupContent}`);

    if (toggleButton && statusDiv && iconImage && errorMessageDiv && componentStatusContainer && httpStatusDiv && ipcStatusDiv && mcpStatusDiv && connectedBanner && httpPortDisplay && settingsButton && settingsPanel && apiPortInput && apiPortDisplayLocked && ipcPipeSettingSpan && mcpPortInput && mcpPortDisplayLocked && saveSettingsButton && closeSettingsButton && mainPopupContent) {
        // updateUI(false, 'Checking...'); // REMOVED: Avoid initial incorrect state flash
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
function updateUI(isConnected: boolean, status: string, components?: ComponentStatus, httpPort?: number | string | null): void {
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
        } else if (components?.http === 'OK') {
            // If connected and HTTP is OK but port wasn't provided, maybe show default?
            httpPortDisplay.textContent = `:${DEFAULT_API_PORT}`; // Consider adding default if connected and OK
        }
    } else {
        statusDiv.style.display = 'block'; // Show general status text when disconnected
        connectedBanner.classList.add('status-hidden');
        connectedBanner.classList.remove('status-visible');
        componentStatusContainer.classList.add('status-hidden');
        componentStatusContainer.classList.remove('status-visible');
        iconImage.src = '/icons/native-host-control-128.png';

        // Handle status text potentially having "Status: " prefix
        const cleanStatus = status.startsWith('Status: ') ? status.substring(8) : status;

        if (cleanStatus === 'Disconnected') { // Check against cleaned status
            statusDiv.textContent = 'Disconnected';
            statusDiv.classList.add('status-grey');
            toggleButton.textContent = 'Connect';
            toggleButton.classList.add('status-green'); // Connect is green
        } else if (cleanStatus === 'Connecting...' || cleanStatus === 'Checking...' || cleanStatus === 'Disconnecting...') {
            statusDiv.textContent = cleanStatus;
            statusDiv.classList.add('status-yellow');
            toggleButton.textContent = cleanStatus; // Show status in button
            toggleButton.classList.add('status-yellow');
            toggleButton.disabled = true;
        } else { // Error states
            statusDiv.textContent = 'Error';
            statusDiv.classList.add('status-red');
            toggleButton.textContent = 'Connect'; // Allow retry
            toggleButton.classList.add('status-green');
            if(status) errorMessageDiv.textContent = status; // Show original full status text in error message
        }
        if (ipcPipeSettingSpan) ipcPipeSettingSpan.textContent = 'N/A';
        httpPortDisplay.textContent = '';
        console.log(`[Popup:updateUI] Setting state to Disconnected/Error (${status}).`);
    }
}

/** Helper to update a single component status div */
function updateComponentStatusDiv(div: HTMLDivElement | null, status?: string): void {
    if (!div) return;
    const checkSpan = div.querySelector<HTMLSpanElement>('.status-check'); // Use querySelector<T>
    if (!checkSpan) return;

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
        // Should not happen based on expected statuses, but handle defensively
        div.classList.add('status-grey');
    }
}

/** Handles clicks on the toggle button */
function handleToggleButtonClick(): void {
    console.log("[Popup] Toggle button clicked.");
    if (toggleButton) {
        // Determine if we are currently trying to connect or disconnect
        const isCurrentlyConnected = toggleButton.textContent === 'Disconnect';
        const nextStateMsg = isCurrentlyConnected ? 'Disconnecting...' : 'Connecting...';

        toggleButton.disabled = true; // Prevent double-clicks while processing
        updateUI(false, nextStateMsg); // Show specific intermediate state (Connecting... or Disconnecting...)

        console.log("[Popup] Sending toggle command...");
        browser.runtime.sendMessage({ command: "toggle" } as BackgroundMessage)
            .then((response: unknown) => {
                const typedResponse = response as PopupMessagePayload | undefined;
                console.log("[Popup] Toggle command processed by background. Waiting for status update message...", typedResponse);
                // No UI update needed here; wait for NATIVE_STATUS_UPDATE or error message
            })
            .catch((error: Error) => {
                const errMsg = `Toggle Error: ${error.message}`;
                console.error("[Popup] Error sending toggle message:", error);
                // Show error and allow retry
                updateUI(false, errMsg);
                if (toggleButton) toggleButton.disabled = false; // Re-enable button ONLY on error
            });
    }
}

/** Sends getStatus command to background script */
function getInitialStatus(): void {
    console.log("[Popup:getInitialStatus] Entered.");
    console.log("[Popup:getInitialStatus] Sending getStatus command immediately...");
    browser.runtime.sendMessage({ command: "getStatus" } as BackgroundMessage)
        .then((response: unknown) => {
            const typedResponse = response as PopupMessagePayload;
            console.log("[Popup:getInitialStatus] Received response: ", typedResponse);
            // Use the full response from background script
            updateUI(
                typedResponse.isConnected ?? false,
                typedResponse.statusText ?? 'Error: No status',
                typedResponse.components,
                typedResponse.httpPort
            );
        })
        .catch((error: Error) => {
            const errMsg = `Get Status Error: ${error.message}`;
            console.error("[Popup:getInitialStatus] Error getting initial status:", error);
            updateUI(false, errMsg); // Show error if status fetch fails
        });
}

// Listen for messages FROM background script
console.log("[Popup] Adding runtime.onMessage listener.");
browser.runtime.onMessage.addListener((message: unknown /* sender: browser.runtime.MessageSender */): void => {
    const typedMessage = message as BackgroundMessage;
    console.log("[Popup:onMessage] Received message: ", typedMessage);
    // Extract payload data if available
    const payload = typedMessage.payload;
    const isConnected = payload?.isConnected;
    const statusText = payload?.statusText;
    const components = payload?.components;
    const httpPort = payload?.httpPort;

    if (typedMessage.type === "NATIVE_DISCONNECTED") {
        console.log("[Popup:onMessage] Handling disconnect message.");
        updateUI(false, 'Disconnected', components); // Pass components if available
    } else if (typedMessage.type === "NATIVE_CONNECT_ERROR") {
        console.log("[Popup:onMessage] Handling connect error message.");
        const errMsg = `Connect Error: ${typedMessage.error || statusText || 'Unknown'}`;
        updateUI(false, errMsg, components); // Pass components if available
    } else if (typedMessage.type === "FROM_NATIVE" && payload?.status === 'ready') {
        // This case might be redundant now if background.ts sends NATIVE_STATUS_UPDATE on ready
        console.log("[Popup:onMessage] Received forwarded 'ready' message. Updating UI.");
        updateUI(true, 'Connected', components, httpPort);
    } else if (typedMessage.type === "NATIVE_STATUS_UPDATE") {
        console.log("[Popup:onMessage] Received status update. Updating UI.");
        // Use the extracted values, which might include components and httpPort
        updateUI(
            isConnected ?? false, // Default to false if undefined
            isConnected ? 'Connected' : (statusText ?? 'Disconnected'), // Provide default statusText if disconnected
            components,
            httpPort
        );
    }
});
console.log("[Popup] Added runtime.onMessage listener.");

// --- Settings Panel Logic ---

function openSettingsPanel(): void {
    console.log("[Popup] openSettingsPanel: Attempting to open...");
    if (!settingsPanel || !apiPortInput || !apiPortDisplayLocked || !ipcPipeSettingSpan || !mcpPortInput || !mcpPortDisplayLocked || !mainPopupContent || !connectedBanner || !saveSettingsButton || !httpPortDisplay) {
        console.error("[Popup] openSettingsPanel: Missing required elements.");
        return;
    }
    console.log("[Popup] openSettingsPanel: Elements found.");

    // Check connection status by looking at the connected banner's visibility
    const isConnected = connectedBanner.classList.contains('status-visible');
    console.log(`[Popup] openSettingsPanel: Connection status: ${isConnected}`);

    // Get the actual current API port from the main display (if connected)
    const currentActualApiPortText = httpPortDisplay.textContent;
    const currentActualApiPort = currentActualApiPortText?.startsWith(':') ? currentActualApiPortText.substring(1) : null;

    // Display static IPC pipe name
    ipcPipeSettingSpan.textContent = IPC_PIPE_DISPLAY_NAME;

    // Load saved ports from storage (we always need these)
    browser.storage.local.get(['apiPort', 'mcpSsePort'])
        .then((result: Settings) => {
            const savedApiPort = result.apiPort ?? '';
            const savedMcpPort = result.mcpSsePort ?? '';
            console.log(`[Popup] openSettingsPanel: Loaded Saved API Port: ${savedApiPort}, Saved MCP Port: ${savedMcpPort}`);

            // Ensure elements exist before accessing properties (re-check needed after async operation)
            if (!apiPortInput || !mcpPortInput || !apiPortDisplayLocked || !mcpPortDisplayLocked || !saveSettingsButton) {
                 console.error("[Popup] openSettingsPanel: Settings elements became null after storage access.");
                 return;
            }

            if (isConnected) {
                // --- Connected State --- 
                // Display actual ports (or defaults), hide inputs, show spans
                apiPortInput.style.display = 'none';
                mcpPortInput.style.display = 'none';
                apiPortDisplayLocked.style.display = 'inline';
                mcpPortDisplayLocked.style.display = 'inline';

                apiPortDisplayLocked.textContent = String(currentActualApiPort || DEFAULT_API_PORT);
                // For MCP, display saved value or 'Not Set' since no actual connected port exists yet
                mcpPortDisplayLocked.textContent = String(savedMcpPort || '(Not Set)');

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
                apiPortInput.value = String(savedApiPort);
                if (!apiPortInput.value && currentActualApiPort) {
                    apiPortInput.placeholder = currentActualApiPort; // Show just the number
                } else {
                    apiPortInput.placeholder = String(DEFAULT_API_PORT); // Show just the default number
                }

                // Load saved MCP Port
                mcpPortInput.value = String(savedMcpPort);
                mcpPortInput.placeholder = "3581"; // Show just the example number

                saveSettingsButton.disabled = false; // Enable save when disconnected
                saveSettingsButton.title = "";
            }

        }).catch((err: Error) => {
            // Error loading storage - default to disconnected view
            console.error("[Popup] openSettingsPanel: Error loading settings from storage:", err);
             // Ensure elements exist before accessing properties
             if (!apiPortInput || !mcpPortInput || !apiPortDisplayLocked || !mcpPortDisplayLocked || !saveSettingsButton) {
                  console.error("[Popup] openSettingsPanel: Settings elements null during storage error handling.");
                  return;
             }
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

function closeSettingsPanel(): void {
    console.log("[Popup] closeSettingsPanel: Attempting to close...");
    if (!settingsPanel || !mainPopupContent) {
         console.error("[Popup] closeSettingsPanel: Missing required elements.");
         return;
    }
    console.log("[Popup] closeSettingsPanel: Removing .settings-active from body.");
    document.body.classList.remove('settings-active');
}

function saveSettings(): void {
    console.log("[Popup] Saving settings...");
    if (!apiPortInput || !mcpPortInput) return;

    const apiPortValue = apiPortInput.value.trim();
    const mcpPortValue = mcpPortInput.value.trim();

    let apiPortNumber: number | '' = '';
    let mcpPortNumber: number | '' = '';

    // Validate API Port
    if (apiPortValue !== '') {
        const parsedApiPort = parseInt(apiPortValue, 10);
        if (isNaN(parsedApiPort) || parsedApiPort < 1 || parsedApiPort > 65535) {
            alert('Invalid API Server Port. Please enter a number between 1 and 65535, or leave it blank to use default.');
            return;
        }
        apiPortNumber = parsedApiPort;
    }

    // Validate MCP Port
    if (mcpPortValue !== '') {
        const parsedMcpPort = parseInt(mcpPortValue, 10);
        if (isNaN(parsedMcpPort) || parsedMcpPort < 1 || parsedMcpPort > 65535) {
            alert('Invalid MCP SSE Port. Please enter a number between 1 and 65535, or leave it blank.');
            return;
        }
        mcpPortNumber = parsedMcpPort;
    }

    const settingsToSave: Settings = {
        apiPort: apiPortNumber,
        mcpSsePort: mcpPortNumber
    };

    // Save the valid port numbers (or empty string if blank)
    browser.storage.local.set(settingsToSave as Record<string, unknown>)
        .then(() => {
            console.log(`[Popup] Saved Settings to storage:`, settingsToSave);
            // Optionally show a success message
            closeSettingsPanel(); // Close panel after saving
        })
        .catch((err: Error) => {
            console.error("[Popup] Error saving settings to storage:", err);
            alert(`Error saving settings: ${err.message}`);
        });
} 