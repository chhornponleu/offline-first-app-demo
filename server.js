// server.js
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, gt, sql } from 'drizzle-orm';
import * as schema from './db/schema.js'; // Using named import
import { items } from './db/schema.js'; // Import items directly for queries

const PORT = 3000;

// --- Database Setup ---
const sqliteServer = new Database('./db/server.db');
const db = drizzle(sqliteServer, { schema });

// Table creation (No syncStatus needed on server DB itself)
try {
    sqliteServer.exec(`
    CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        value INTEGER,
        last_updated INTEGER NOT NULL
    );
`);
    console.log("Server database table checked/created.");

    // Optional: Seed data (no syncStatus needed here)
    const countResult = await db.select({ count: sql < number > `count(*)` }).from(items);
    if (countResult[0].count === 0) {
        console.log("Seeding server database...");
        await db.insert(items).values([
            { id: 'item-1', name: 'Server Item A', value: 100, lastUpdated: new Date(Date.now() - 100000) },
            { id: 'item-2', name: 'Server Item B', value: 200, lastUpdated: new Date(Date.now() - 90000) },
        ]);
        console.log("Server database seeded.");
    }
} catch (err) {
    console.error("Server DB setup error:", err);
    process.exit(1);
}

// --- Express App Setup ---
const app = express();
app.use(express.json());

// --- API Endpoints ---

// PULL Endpoint: Remains the same, based on timestamp
app.get('/pull', async (req, res) => {
    let lastSyncTime = 0;
    const lastSyncTimeQueryParam = req.query.lastSyncTime as string;

    if (lastSyncTimeQueryParam) {
        const parsedTime = parseInt(lastSyncTimeQueryParam, 10);
        if (!isNaN(parsedTime)) {
            lastSyncTime = parsedTime;
            console.log(`[Server] PULL since: ${new Date(lastSyncTime).toISOString()}`);
        } else {
            console.warn(`[Server] Invalid lastSyncTime param: "${lastSyncTimeQueryParam}". Defaulting to initial sync.`);
            console.log(`[Server] Processing PULL as initial sync.`);
        }
    } else {
        console.log(`[Server] PULL request without lastSyncTime. Performing initial sync.`);
    }

    try {
        const changes = await db.select()
            .from(items)
            .where(gt(items.lastUpdated, new Date(lastSyncTime)));
        console.log(`[Server] Sending ${changes.length} changes.`);
        res.json({ changes });
    } catch (error) {
        console.error("[Server] PULL Error:", error);
        res.status(500).json({ error: "Failed to pull changes" });
    }
});

// PUSH Endpoint: Updated response format
app.post('/push', async (req, res) => {
    const clientChanges: schema.Item[] = req.body.changes; // Expect full Item structure
    console.log(`[Server] Received PUSH request with ${clientChanges?.length || 0} items.`);

    if (!Array.isArray(clientChanges)) {
        return res.status(400).json({ error: 'Invalid payload format. "changes" array expected.' });
    }

    // --- RESPONSE FORMAT CHANGE: Array of objects for success ---
    const results = {
        success: [] as { id: string, newTimestamp: number }[],
        failed: [] as { id: string, reason: string }[],
    };
    const serverNow = new Date(); // Consistent timestamp for this batch

    try {
        // Consider wrapping in a transaction using db.transaction(...)
        for (const clientItem of clientChanges) {
            // Basic validation (adapt as needed)
            if (!clientItem.id || !clientItem.name || !clientItem.lastUpdated) {
                results.failed.push({ id: clientItem.id || 'unknown', reason: 'Missing required fields (id, name, lastUpdated)' });
                continue;
            }

            const clientLastUpdated = new Date(clientItem.lastUpdated);
            // Note: Server doesn't care about client's syncStatus, only lastUpdated for conflict check

            try {
                const existingServerItem = await db.query.items.findFirst({
                    where: eq(items.id, clientItem.id),
                });
                const currentServerTimestampMs = serverNow.getTime(); // Use milliseconds for response

                if (existingServerItem) {
                    // --- Update ---
                    const serverLastUpdated = new Date(existingServerItem.lastUpdated);
                    if (clientLastUpdated >= serverLastUpdated) { // Allow equal for retries
                        await db.update(items)
                            .set({
                                name: clientItem.name,
                                value: clientItem.value,
                                lastUpdated: serverNow, // Update server timestamp
                            })
                            .where(eq(items.id, clientItem.id));
                        console.log(`[Server] Updated item ${clientItem.id}`);
                        // --- PUSH RESPONSE: Add object to success ---
                        results.success.push({ id: clientItem.id, newTimestamp: currentServerTimestampMs });
                    } else {
                        console.warn(`[Server] Rejected update for ${clientItem.id}. Server version (${serverLastUpdated.toISOString()}) is newer than client version (${clientLastUpdated.toISOString()}).`);
                        results.failed.push({ id: clientItem.id, reason: 'Conflict: Server version is newer' });
                    }
                } else {
                    // --- Insert ---
                    await db.insert(items).values({
                        id: clientItem.id,
                        name: clientItem.name,
                        value: clientItem.value,
                        lastUpdated: serverNow, // Set server timestamp
                        // No syncStatus needed on server DB
                    });
                    console.log(`[Server] Inserted new item ${clientItem.id}`);
                    // --- PUSH RESPONSE: Add object to success ---
                    results.success.push({ id: clientItem.id, newTimestamp: currentServerTimestampMs });
                }
            } catch (itemError) {
                console.error(`[Server] Error processing item ${clientItem.id}:`, itemError);
                results.failed.push({ id: clientItem.id, reason: `Server error: ${itemError.message}` });
            }
        }
        res.json(results);
    } catch (error) {
        console.error("[Server] PUSH Error:", error);
        res.status(500).json({ error: "Failed to process push request" });
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});