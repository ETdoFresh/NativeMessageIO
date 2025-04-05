import * as fs from 'fs';
import * as process from 'process';

// Helper function to read exactly `length` bytes from stdin
function readStdin(length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const buffer = Buffer.alloc(length);
        let bytesRead = 0;
        const onReadable = () => {
            let chunk;
            // Read until the desired length is reached
            while (null !== (chunk = process.stdin.read(length - bytesRead))) {
                chunk.copy(buffer, bytesRead);
                bytesRead += chunk.length;
                if (bytesRead === length) {
                    process.stdin.removeListener('readable', onReadable);
                    resolve(buffer);
                    return;
                }
            }
        };
        process.stdin.on('readable', onReadable);
        process.stdin.on('end', () => {
            if (bytesRead < length) {
                reject(new Error('stdin ended before required length was read.'));
            }
        });
        process.stdin.on('error', reject);
        // Start the flow
        process.stdin.resume();
        // Trigger the read if needed (especially for smaller chunks)
        if (process.stdin.readableLength < length - bytesRead) {
             process.stdin.read(0);
        }
    });
}

// Helper function to write message to stdout (length prefix + message)
function writeStdout(message: any): Promise<void> {
    return new Promise((resolve, reject) => {
        const messageString = JSON.stringify(message);
        const messageBuffer = Buffer.from(messageString, 'utf8');
        const lengthBuffer = Buffer.alloc(4);
        lengthBuffer.writeUInt32LE(messageBuffer.length, 0); // Use Little Endian for native byte order (common)

        process.stdout.write(lengthBuffer, (err) => {
            if (err) return reject(err);
            process.stdout.write(messageBuffer, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    });
}

async function main() {
    try {
        // 1. Read the 4-byte length header
        const lengthBuffer = await readStdin(4);
        const messageLength = lengthBuffer.readUInt32LE(0); // Assuming Little Endian

        // 2. Read the message body
        const messageBuffer = await readStdin(messageLength);
        const messageJson = messageBuffer.toString('utf8');

        // 3. Parse the message
        const receivedMessage = JSON.parse(messageJson);

        // 4. Log the message (to stderr to avoid interfering with stdout protocol)
        console.error(`Native Host (${process.pid}): Received message length: ${messageLength}`);
        console.error(`Native Host (${process.pid}): Received message content:`, receivedMessage);

        // 5. Send a response back (required for sendNativeMessage)
        const responseMessage = { status: "success", received: receivedMessage, pid: process.pid };
        await writeStdout(responseMessage);
        console.error(`Native Host (${process.pid}): Sent response.`);

        // Exit gracefully after processing one message (for sendNativeMessage)
        // process.exit(0); // Exiting might close stdio prematurely in some cases, let node exit naturally

    } catch (error) {
        console.error(`Native Host (${process.pid}) Error:`, error);
        // Try sending an error response if possible
        try {
            await writeStdout({ status: "error", message: error instanceof Error ? error.message : String(error), pid: process.pid });
        } catch (writeError) {
            console.error(`Native Host (${process.pid}): Failed to send error response:`, writeError);
        }
        process.exit(1);
    }
}

// Ensure stdin is flowing
process.stdin.resume();
console.error(`Native Host (${process.pid}): Script started, waiting for message...`);
main(); 