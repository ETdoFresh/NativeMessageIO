import { SERVER_NAME } from '../config.js';

/** Logs messages consistently to stderr to avoid interfering with stdout (native messaging) */
export function logStdErr(message: string, ...optionalParams: any[]): void {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}][${SERVER_NAME}] ${message}`, ...optionalParams);
} 