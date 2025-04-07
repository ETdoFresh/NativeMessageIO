/**
 * Popup Script for Native Message IO Extension
 * Handles UI interactions, settings, and communication with the background script.
 */
console.log("[Popup] Script top level - waiting for DOMContentLoaded.");

// --- Type Definitions (Consider sharing with background/commands if complex) ---
interface Settings {
    apiPort?: number | ''; // Allow empty string for default
    ipcPipeName?: string; // Read-only for now
    mcpPort?: number | ''; // For potential future TCP/UDP MCP
}

// Matches the structure sent from background script
interface ComponentStatus {
    http?: string;
    ipc?: string;
    mcp?: string;
    nativeMessaging?: string; // Added as native host sends this
}

interface StatusPayload {
    isConnected: boolean;
    statusText: string;
    components?: ComponentStatus;
    httpPort?: number | string | null;
}

// --- Constants ---
const DEFAULT_API_PORT = 3580;
const DEFAULT_IPC_PIPE_NAME = 'native-message-io-ipc-pipe'; // Default pipe name

// --- Global Variables & UI Element References ---
let statusDiv: HTMLDivElement | null = null;
let toggleButton: HTMLButtonElement | null = null;
let iconImage: HTMLImageElement | null = null;
let errorMessageDiv: HTMLDivElement | null = null;
let componentStatusContainer: HTMLDivElement | null = null;
let httpStatusDiv: HTMLDivElement | null = null;
let ipcStatusDiv: HTMLDivElement | null = null;
let mcpStatusDiv: HTMLDivElement | null = null;
let connectedBanner: HTMLDivElement | null = null;
let httpPortDisplay: HTMLSpanElement | null = null;
let mainPopupContent: HTMLDivElement | null = null;

// Settings Panel Elements
let settingsButton: HTMLButtonElement | null = null;
let settingsPanel: HTMLDivElement | null = null;
let apiPortInput: HTMLInputElement | null = null;
let apiPortDisplayLocked: HTMLSpanElement | null = null;
let ipcPipeSettingSpan: HTMLSpanElement | null = null;
let mcpPortInput: HTMLInputElement | null = null;
let mcpPortDisplayLocked: HTMLSpanElement | null = null;
let saveSettingsButton: HTMLButtonElement | null = null;
let closeSettingsButton: HTMLButtonElement | null = null;


// --- Initialization and Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    console.log('[Popup] DOMContentLoaded event fired.');

    // Acquire references to UI elements - Using IDs from popup.html
    statusDiv = document.getElementById('statusText') as HTMLDivElement;
    toggleButton = document.getElementById('toggleButton') as HTMLButtonElement;
    iconImage = document.getElementById('iconImage') as HTMLImageElement;
    errorMessageDiv = document.getElementById('errorMessage') as HTMLDivElement;
    componentStatusContainer = document.getElementById('componentStatusContainer') as HTMLDivElement;
    httpStatusDiv = document.getElementById('httpStatus') as HTMLDivElement;
    ipcStatusDiv = document.getElementById('ipcStatus') as HTMLDivElement;
    mcpStatusDiv = document.getElementById('mcpStatus') as HTMLDivElement;
    connectedBanner = document.getElementById('connectedBanner') as HTMLDivElement;
    httpPortDisplay = document.getElementById('httpPortDisplay') as HTMLSpanElement;
    mainPopupContent = document.getElementById('mainContent') as HTMLDivElement;

    // Acquire Settings elements - Using IDs from popup.html
    settingsButton = document.getElementById('settingsButton') as HTMLButtonElement;
    settingsPanel = document.getElementById('settingsPanel') as HTMLDivElement;
    apiPortInput = document.getElementById('apiPortInput') as HTMLInputElement;
    apiPortDisplayLocked = document.getElementById('apiPortDisplayLocked') as HTMLSpanElement;
    ipcPipeSettingSpan = document.getElementById('ipcPipeSetting') as HTMLSpanElement;
    mcpPortInput = document.getElementById('mcpPortInput') as HTMLInputElement;
    mcpPortDisplayLocked = document.getElementById('mcpPortDisplayLocked') as HTMLSpanElement;
    saveSettingsButton = document.getElementById('saveSettingsButton') as HTMLButtonElement;
    closeSettingsButton = document.getElementById('closeSettingsButton') as HTMLButtonElement;


    console.log(`[Popup] Elements acquired: statusDiv=${!!statusDiv}, toggleButton=${!!toggleButton}, iconImage=${!!iconImage}, errorMessageDiv=${!!errorMessageDiv}, componentStatusContainer=${!!componentStatusContainer}, httpPortDisplay=${!!httpPortDisplay}, mainPopupContent=${!!mainPopupContent}`);
    console.log(`[Popup] Settings elements acquired: settingsButton=${!!settingsButton}, settingsPanel=${!!settingsPanel}, apiPortInput=${!!apiPortInput}, apiPortDisplayLocked=${!!apiPortDisplayLocked}, ipcPipeSettingSpan=${!!ipcPipeSettingSpan}, mcpPortInput=${!!mcpPortInput}, mcpPortDisplayLocked=${!!mcpPortDisplayLocked}, saveSettingsButton=${!!saveSettingsButton}, closeSettingsButton=${!!closeSettingsButton}`);

    // Add listener for the main toggle button
    if (toggleButton) {
        toggleButton.addEventListener('click', handleToggleClick);
        console.log('[Popup] Added toggle button listener.');
    } else {
        console.error('[Popup] Toggle button not found!');
    }

    // Add listeners for settings interactions
    if (settingsButton && settingsPanel && saveSettingsButton && closeSettingsButton && apiPortInput && mcpPortInput) {
        settingsButton.addEventListener('click', toggleSettingsPanel);
        saveSettingsButton.addEventListener('click', saveSettings);
        closeSettingsButton.addEventListener('click', () => settingsPanel!.style.display = 'none'); // Use body class instead?
        console.log('[Popup] Added settings listeners.');
    } else {
        console.error('[Popup] Settings UI elements missing!');
    } 

    // Initial UI state before getting status
    updateUI(false, "Status: Checking...");

    // Get initial status from background script
    console.log('[Popup] DOM Ready. Calling getInitialStatus()...');
    getInitialStatus();
});


// --- UI Update Function (Restored) ---

/** Updates the UI elements based on connection status and component details */
function updateUI(isConnected: boolean, status: string, components?: ComponentStatus, httpPort?: number | string | null): void {
    console.log(`[Popup:updateUI] Called with isConnected=${isConnected}, status=${status}, components=`, components, `, httpPort=${httpPort}`);

    // Ensure all potentially used elements are checked
    if (!toggleButton || !statusDiv || !iconImage || !errorMessageDiv || !componentStatusContainer || !httpStatusDiv || !ipcStatusDiv || !mcpStatusDiv || !connectedBanner || !httpPortDisplay || !mainPopupContent) {
        console.error("[Popup:updateUI] Missing one or more required UI elements for update.");
        return;
    }

    // --- Reset states ---
    errorMessageDiv.textContent = '';
    errorMessageDiv.style.display = 'none';
    statusDiv.textContent = status;
    statusDiv.className = 'status-text'; // Reset classes
    statusDiv.style.display = 'block'; // Default to visible
    toggleButton.className = 'button'; // Reset classes
    toggleButton.disabled = false;
    componentStatusContainer.classList.add('status-hidden');
    componentStatusContainer.classList.remove('status-visible');
    connectedBanner.classList.add('status-hidden');
    connectedBanner.classList.remove('status-visible');
    updateComponentStatusDiv(httpStatusDiv); // Reset style
    updateComponentStatusDiv(ipcStatusDiv); // Reset style
    updateComponentStatusDiv(mcpStatusDiv); // Reset style
    httpPortDisplay.textContent = '';
    document.body.classList.remove('connected', 'disconnected'); // Reset body classes
    mainPopupContent.style.display = 'block'; // Default to visible

    // --- Apply new states ---
    if (isConnected) {
        console.log("[Popup:updateUI] Setting state to Connected.");
        document.body.classList.add('connected');
        statusDiv.style.display = 'none'; // Hide general status text when connected
        connectedBanner.classList.remove('status-hidden');
        connectedBanner.classList.add('status-visible');
        componentStatusContainer.classList.remove('status-hidden');
        componentStatusContainer.classList.add('status-visible');
        toggleButton.textContent = 'Disconnect';
        toggleButton.classList.add('status-red'); // Disconnect is red
        iconImage.src = '/icons/native-host-control-connected-128.png';

        // Update component status indicators
        updateComponentStatusDiv(httpStatusDiv, components?.http);
        updateComponentStatusDiv(ipcStatusDiv, components?.ipc);
        updateComponentStatusDiv(mcpStatusDiv, components?.mcp);

        // Update HTTP Port display
        if (httpPort) {
            httpPortDisplay.textContent = `:${httpPort}`;
        } else if (components?.http === 'OK') {
             // If connected and HTTP is OK but port wasn't provided, maybe show default?
             httpPortDisplay.textContent = `:${DEFAULT_API_PORT}`; // Consider adding default if connected and OK
        }

    } else {
        // --- Disconnected/Error State ---
        console.log(`[Popup:updateUI] Setting state to Disconnected/Error (${status}).`);
        document.body.classList.add('disconnected');
        iconImage.src = '/icons/native-host-control-128.png';

        // Handle status text potentially having "Status: " prefix or being an error message
        const cleanStatus = status.startsWith('Status: ') ? status.substring(8) : status;

        if (cleanStatus === 'Disconnected' || cleanStatus === 'Checking...') {
            statusDiv.textContent = cleanStatus;
            statusDiv.classList.add('status-grey');
            toggleButton.textContent = 'Connect';
            toggleButton.classList.add('status-green'); // Connect is green
        } else if (cleanStatus === 'Connecting...' || cleanStatus === 'Disconnecting...') {
            statusDiv.textContent = cleanStatus;
            statusDiv.classList.add('status-yellow');
            toggleButton.textContent = cleanStatus; // Show status in button
            toggleButton.classList.add('status-yellow');
            toggleButton.disabled = true;
        } else { // Error states
            statusDiv.textContent = 'Error'; // Simple label
            statusDiv.classList.add('status-red');
            errorMessageDiv.textContent = status; // Show full error message
            errorMessageDiv.style.display = 'block';
            toggleButton.textContent = 'Connect'; // Allow retry
            toggleButton.classList.add('status-green');
        }
    }
}

/** Helper to update a single component status div */
function updateComponentStatusDiv(div: HTMLDivElement | null, status?: string): void {
    if (!div) return;
    const checkSpan = div.querySelector<HTMLSpanElement>('.status-check');
    if (!checkSpan) return;

    // Reset classes and checkmark
    div.className = 'component-status'; // Base class
    checkSpan.textContent = ''; // Clear checkmark
    div.title = ''; // Clear tooltip

    if (status === undefined || status === 'pending' || !status) {
        div.classList.add('status-grey');
    } else if (status === 'OK' || status === 'listening') {
        div.classList.add('status-green');
        checkSpan.textContent = ' ✔️'; // Add checkmark for OK status
    } else if (status.toLowerCase().includes('error')) {
        div.title = status; // Show full error on hover
        div.classList.add('status-red');
        checkSpan.textContent = ' ❌'; // Add an 'x' for errors
    } else {
        // Unknown status - treat as pending/grey
        div.classList.add('status-grey');
        div.title = `Unknown status: ${status}`;
    }
}

// --- Event Handlers ---

/** Handles clicks on the main Connect/Disconnect button */
function handleToggleClick(): void {
    console.log('[Popup] Toggle button clicked.');
    if (toggleButton) {
        // Determine current state from button text/class
        const isCurrentlyConnected = toggleButton.textContent === 'Disconnect';
        const actionText = isCurrentlyConnected ? 'Status: Disconnecting...' : 'Status: Connecting...';

        // Immediately update UI to show connecting/disconnecting state
        updateUI(false, actionText); // Update state visually (show as disconnected + status)

        // Send command to background script
        console.log('[Popup] Sending toggle command...');
        browser.runtime.sendMessage({ command: 'toggle' })
            .then(response => {
                console.log('[Popup] Toggle command processed by background. Waiting for status update message...', response);
                // Background script should send a NATIVE_STATUS_UPDATE message soon
            })
            .catch(err => {
                console.error('[Popup] Error sending toggle command:', err);
                updateUI(false, `Error: ${err.message}`);
            });
    }
}

/** Gets initial connection status from background script */
function getInitialStatus(): void {
    console.log('[Popup:getInitialStatus] Entered.');
    console.log('[Popup:getInitialStatus] Sending getStatus command immediately...');
    browser.runtime.sendMessage({ command: 'getStatus' })
        .then((response: StatusPayload) => { // Expect the full payload now
             console.log('[Popup:getInitialStatus] Received response: ', response);
             if (response && typeof response.isConnected === 'boolean' && typeof response.statusText === 'string') {
                 // Pass all parts of the payload to the restored updateUI
                 updateUI(response.isConnected, response.statusText, response.components, response.httpPort);
             } else {
                 console.warn("[Popup:getInitialStatus] Received unexpected response format:", response);
                 updateUI(false, "Status: Error getting initial state"); // Fallback UI state
             }
        })
        .catch(err => {
            console.error('[Popup:getInitialStatus] Error getting status:', err);
            updateUI(false, `Status: Error (${err.message})`); // Update UI to show error
        });
}

// --- Runtime Message Listener ---

console.log('[Popup] Adding runtime.onMessage listener.');

/** Handles messages received from the background script */
function handleRuntimeMessage(message: any, sender: browser.runtime.MessageSender): void | Promise<any> {
    console.log('[Popup:onMessage] Received message: ', message);

    if (!message || !message.type) {
        console.warn("[Popup:onMessage] Received message without type:", message);
        return;
    }

    switch (message.type) {
        case 'NATIVE_STATUS_UPDATE': {
            console.log('[Popup:onMessage] Received status update. Updating UI.');
            const payload = message.payload as StatusPayload;
            if (payload && typeof payload.isConnected === 'boolean' && typeof payload.statusText === 'string') {
                // Pass the full payload to the restored updateUI
                updateUI(payload.isConnected, payload.statusText, payload.components, payload.httpPort);
            } else {
                 console.warn("[Popup:onMessage] Received NATIVE_STATUS_UPDATE with invalid payload:", message.payload);
                 updateUI(false, "Status: Error (Invalid Update)");
            }
            break;
        }
        case 'LOG_UPDATE':
            // console.log("POPUP LOG:", message.payload);
            break;
        case 'NATIVE_ERROR':
             console.log(`[Popup:onMessage] Received native error: ${JSON.stringify(message.payload)}`);
             const errorPayload = message.payload || {};
             const errorMessage = `Error: ${errorPayload.message || 'Unknown Error'}` + (errorPayload.command ? ` (Cmd: ${errorPayload.command})` : '');
             // Display the error using updateUI for consistency
             updateUI(false, errorMessage, undefined, undefined); // Show as disconnected with the error message
             break;
        case 'CONSOLE_RESULT': // Renamed from NATIVE_DATA for clarity
        case 'NATIVE_DATA': // Keep handling NATIVE_DATA for other simple statuses
             console.log(`[Popup:onMessage] Received data/result: ${JSON.stringify(message.payload)}`);
             // Display simple feedback in the status div for now
             if (statusDiv && message.payload?.status) {
                  statusDiv.textContent = `Status: ${message.payload.status}`; // Show transient status
                  statusDiv.classList.remove('error');
             } else {
                 console.warn("[Popup:onMessage] Received CONSOLE_RESULT/NATIVE_DATA without payload.status", message);
             }
             break;
        default:
            console.log(`[Popup:onMessage] Received unknown message type: ${message.type}`);
            break;
    }
}

browser.runtime.onMessage.addListener(handleRuntimeMessage);
console.log('[Popup] Added runtime.onMessage listener.');


// --- Settings Panel Logic ---

/** Toggles the visibility of the settings panel */
function toggleSettingsPanel(): void {
    if (!settingsPanel || !mainPopupContent) return;
    const isVisible = settingsPanel.style.display === 'block';
    settingsPanel.style.display = isVisible ? 'none' : 'block';
    mainPopupContent.style.display = isVisible ? 'block' : 'none'; // Hide main content when settings open
    if (!isVisible) {
        loadSettings(); // Load current settings when opening
    }
}

/** Loads settings from storage and populates the inputs */
function loadSettings(): void {
     console.log("[Popup:loadSettings] Loading settings...");
     // Ensure elements exist before proceeding (needed after async potentially)
     if (!apiPortInput || !mcpPortInput || !ipcPipeSettingSpan || !apiPortDisplayLocked || !mcpPortDisplayLocked || !saveSettingsButton || !httpPortDisplay) {
          console.error("[Popup:loadSettings] Settings UI elements not found before loading.");
          return;
     }

    browser.storage.sync.get(['apiPort', 'ipcPipeName', 'mcpPort'])
        .then((result: Settings) => {
            console.log("[Popup:loadSettings] Loaded settings:", result);

            // Re-check elements used inside .then() for extra safety, although outer check should suffice
            if (!apiPortInput || !mcpPortInput || !ipcPipeSettingSpan || !apiPortDisplayLocked || !mcpPortDisplayLocked || !saveSettingsButton || !httpPortDisplay) {
                console.error("[Popup:loadSettings] Settings UI elements became null inside .then()");
                return;
            }

            // Determine connection status (needed to decide input vs locked display)
            const isConnected = document.body.classList.contains('connected');

            // Get the actual current API port from the main display (if connected)
            const currentActualApiPortText = httpPortDisplay.textContent ?? '';
            const currentActualApiPort = currentActualApiPortText.startsWith(':') ? currentActualApiPortText.substring(1) : null;

            const savedApiPort = result.apiPort ?? '';
            const savedMcpPort = result.mcpPort ?? '';
            const ipcPipeName = result.ipcPipeName ?? DEFAULT_IPC_PIPE_NAME;

            ipcPipeSettingSpan.textContent = ipcPipeName;

            if (isConnected) {
                 // --- Connected State --- 
                 apiPortInput.style.display = 'none';
                 mcpPortInput.style.display = 'none';
                 apiPortDisplayLocked.style.display = 'inline';
                 mcpPortDisplayLocked.style.display = 'inline';

                 apiPortDisplayLocked.textContent = String(currentActualApiPort || DEFAULT_API_PORT);
                 // MCP port isn't dynamically reported, show saved or default
                 mcpPortDisplayLocked.textContent = String(savedMcpPort || '(Not Set)');

                 saveSettingsButton.disabled = true;
                 saveSettingsButton.title = "Disconnect to change settings";
            } else {
                 // --- Disconnected State ---
                 apiPortInput.style.display = 'block';
                 mcpPortInput.style.display = 'block';
                 apiPortDisplayLocked.style.display = 'none';
                 mcpPortDisplayLocked.style.display = 'none';

                 apiPortInput.value = String(savedApiPort);
                 apiPortInput.placeholder = String(DEFAULT_API_PORT);

                 mcpPortInput.value = String(savedMcpPort);
                 mcpPortInput.placeholder = "(Optional, e.g., 3581)";

                 saveSettingsButton.disabled = false;
                 saveSettingsButton.title = "";
            }

        }).catch(err => {
            console.error("[Popup:loadSettings] Error loading settings:", err);
            // Fallback to disconnected state display with defaults
            if (apiPortInput) {
                 apiPortInput.style.display = 'block';
                 apiPortInput.value = '';
                 apiPortInput.placeholder = String(DEFAULT_API_PORT);
            }
             if (mcpPortInput) {
                 mcpPortInput.style.display = 'block';
                 mcpPortInput.value = '';
                 mcpPortInput.placeholder = "(Optional, e.g., 3581)";
             }
             if (apiPortDisplayLocked) apiPortDisplayLocked.style.display = 'none';
             if (mcpPortDisplayLocked) mcpPortDisplayLocked.style.display = 'none';
             if (ipcPipeSettingSpan) ipcPipeSettingSpan.textContent = DEFAULT_IPC_PIPE_NAME;
             if (saveSettingsButton) saveSettingsButton.disabled = false;
        });
}

/** Saves settings from inputs to storage */
function saveSettings(): void {
    console.log("[Popup:saveSettings] Attempting to save settings...");
    // Check elements used in this function
    if (!apiPortInput || !mcpPortInput || !settingsPanel || !mainPopupContent) {
         console.error("[Popup:saveSettings] Settings input/panel elements not found.");
         alert("Error: Could not find settings input fields.");
         return;
    }

    const apiPortValue = apiPortInput.value.trim();
    const mcpPortValue = mcpPortInput.value.trim();
    let apiPortNumber: number | '' = '';
    let mcpPortNumber: number | '' = '';

    // Validate API Port
    if (apiPortValue !== '') {
        const parsed = parseInt(apiPortValue, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
            alert('Invalid API Server Port. Must be 1-65535 or blank for default.');
            return;
        }
        apiPortNumber = parsed;
    }

    // Validate MCP Port
    if (mcpPortValue !== '') {
        const parsed = parseInt(mcpPortValue, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
            alert('Invalid MCP SSE Port. Must be 1-65535 or blank.');
            return;
        }
        mcpPortNumber = parsed;
    }

    const newSettings: Settings = {
        apiPort: apiPortNumber,
        mcpPort: mcpPortNumber
        // ipcPipeName is not saved here as it's not user-configurable
    };

     console.log("[Popup:saveSettings] Saving settings:", newSettings);
    browser.storage.sync.set(newSettings)
        .then(() => {
            console.log("[Popup:saveSettings] Settings saved successfully.");
            alert('Settings saved!');
            // Close panel after saving
            if (settingsPanel && mainPopupContent) {
                settingsPanel.style.display = 'none';
                mainPopupContent.style.display = 'block';
            }
        })
        .catch(err => {
            console.error("[Popup:saveSettings] Error saving settings:", err);
            alert(`Error saving settings: ${err.message}`);
        });
} 