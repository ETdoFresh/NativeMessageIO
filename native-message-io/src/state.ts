import { EventEmitter } from 'events';

// --- Central Event Emitter ---
// Used to broadcast messages received from any source
export const messageEmitter = new EventEmitter();

// --- Component Status Tracking ---
export interface ComponentStatus {
    http: string;
    ipc: string;
    mcp: string;
    nativeMessaging: string;
}

export let componentStatus: ComponentStatus = {
    http: "pending",
    ipc: "pending",
    mcp: "pending",
    nativeMessaging: "pending"
};

export function updateComponentStatus(component: keyof ComponentStatus, status: string) {
    componentStatus[component] = status;
    messageEmitter.emit('status', componentStatus); // Emit status update
} 