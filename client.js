// client.js
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, gt, sql } from 'drizzle-orm';
import * as schema from './db/schema.js';
import { items } from './db/schema.js'; // Import items directly for queries
import fs from 'fs/promises';
import path from 'path';

// Use node-fetch or native fetch
// import fetch from 'node-fetch';
const SERVER_URL = 'http://localhost:3000';
const SYNC_STATE_FILE = './db/syncState.json';

// --- Database Setup ---
const sqliteClient = new Database('./db/client.db');
const db = drizzle(sqliteClient, { schema });

// Table creation - Ensure syncStatus column exists with default
try {
    sqliteClient.exec(`
    CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        value INTEGER,
        last_updated INTEGER NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'synced'
    );
`);
    // Add sync_status column if it doesn't exist (for upgrading existing dbs)
    try {
        sqliteClient.exec(`ALTER TABLE items ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced';`);
        console.log("Added sync_status column to existing client table.");
    } catch (alterError) {
        // Ignore error if column already exists (specific error codes vary by SQLite version)
        if (!alterError.message.includes('duplicate column name')) {
            console.warn("Could not add sync_status column (may already exist):", alterError.message);
        }
    }

    await fs.mkdir(path.dirname(SYNC_STATE_FILE), { recursive: true });
    console.log("Client database table checked/created.");
} catch (err) {
    console.error("Client DB setup error:", err);
    process.exit(1);
}

// --- Sync State Management (Remains the same) ---
async function getLastSyncTime(): Promise<number> { /* ... (no changes needed) ... */
    try {
        const data = await fs.readFile(SYNC_STATE_FILE, 'utf-8');
        return JSON.parse(data).lastSyncTime || 0;
    } catch (error) {
        if (error.code === 'ENOENT') { console.log("Sync state file not found, starting fresh sync."); }
        else { console.error("Error reading sync state:", error); }
        return 0;
    }
}
async function saveLastSyncTime(timestamp: number): Promise<void> { /* ... (no changes needed) ... */
    try {
        await fs.writeFile(SYNC_STATE_FILE, JSON.stringify({ lastSyncTime: timestamp }));
    } catch (error) { console.error("Error saving sync state:", error); }
}

// --- Sync Logic: Pull then Push with syncStatus ---
async function synchronize() {
    console.log("\n--- Starting Synchronization ---");
    const lastSyncTime = await getLastSyncTime();
    const currentSyncStartTime = Date.now(); // Use start time for next sync's 'since'

    // 1. PULL Changes from Server (Remains the same)
    console.log(`[Client] Pulling changes since ${new Date(lastSyncTime).toISOString()}...`);
    let serverChanges: schema.Item[] = [];
    try {
        const response = await fetch(`${SERVER_URL}/pull?lastSyncTime=${lastSyncTime}`);
        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
        const data = await response.json();
        serverChanges = data.changes || [];
        console.log(`[Client] Received ${serverChanges.length} changes from server.`);
    } catch (error) { /* ... (error handling) ... */
        console.error("[Client] PULL failed:", error);
        console.log("--- Synchronization Aborted (Pull Failed) ---");
        return;
    }

    // 2. MERGE Server Changes into Local DB (Update to set syncStatus='synced')
    console.log("[Client] Merging server changes locally...");
    let mergeConflicts = 0; // Simple counter for logging
    try {
        // Consider db.transaction(...) for atomicity
        for (const serverItem of serverChanges) {
            const serverLastUpdated = new Date(serverItem.lastUpdated);
            const localItem = await db.query.items.findFirst({ where: eq(items.id, serverItem.id) });

            if (localItem) { // Item exists locally
                const localLastUpdated = new Date(localItem.lastUpdated);
                if (serverLastUpdated > localLastUpdated) {
                    console.log(` -> Updating local item ${serverItem.id} from server.`);
                    await db.update(items)
                        .set({
                            name: serverItem.name,
                            value: serverItem.value,
                            lastUpdated: serverLastUpdated,
                            syncStatus: 'synced', // <-- Set status to synced on merge update
                        })
                        .where(eq(items.id, serverItem.id));
                } else if (serverLastUpdated < localLastUpdated && localItem.syncStatus === 'modified') {
                    // CONFLICT: Local is newer AND modified. Keep local as modified for now.
                    // A real app needs proper conflict resolution here.
                    console.warn(` -> CONFLICT: Local item ${serverItem.id} is modified and newer than server version. Keeping local modified state.`);
                    mergeConflicts++;
                } else {
                    // Timestamps match, or local is newer but already synced. No action needed.
                }
            } else { // Item is new locally
                console.log(` -> Inserting new item ${serverItem.id} from server.`);
                await db.insert(items).values({
                    id: serverItem.id,
                    name: serverItem.name,
                    value: serverItem.value,
                    lastUpdated: serverLastUpdated,
                    syncStatus: 'synced', // <-- Set status to synced on insert from server
                });
            }
        }
        console.log(`[Client] Merge complete. ${mergeConflicts} potential conflicts logged.`);
    } catch (error) { /* ... (error handling) ... */
        console.error("[Client] MERGE failed:", error);
        console.log("--- Synchronization Aborted (Merge Failed) ---");
        return;
    }


    // 3. IDENTIFY Local Changes to Push (Query based on syncStatus)
    console.log("[Client] Identifying local changes to push (syncStatus = 'modified')...");
    let localChangesToPush: schema.Item[] = [];
    try {
        // --- QUERY CHANGED ---
        localChangesToPush = await db.select()
            .from(items)
            .where(eq(items.syncStatus, 'modified')); // Select items marked as modified
        console.log(`[Client] Found ${localChangesToPush.length} local changes to push.`);
    } catch (error) { /* ... (error handling) ... */
        console.error("[Client] Failed to identify local changes:", error);
        console.log("--- Synchronization Aborted (Identify Failed) ---");
        return;
    }

    // 4. PUSH Local Changes to Server (Handle response to update syncStatus)
    if (localChangesToPush.length > 0) {
        console.log("[Client] Pushing local changes to server...");
        try {
            const response = await fetch(`${SERVER_URL}/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ changes: localChangesToPush }),
            });
            if (!response.ok) {
                throw new Error(`Server error: ${response.statusText} - ${await response.text()}`);
            }
            const pushResult = await response.json(); // Expect { success: [{id, newTimestamp}], failed: [...] }
            console.log("[Client] PUSH Response:", pushResult);

            // --- NEW: Update local status based on push success ---
            if (pushResult.success && pushResult.success.length > 0) {
                console.log("[Client] Updating status for successfully pushed items...");
                try {
                    // Consider db.transaction(...)
                    for (const successItem of pushResult.success) {
                        if (successItem.id && successItem.newTimestamp) {
                            await db.update(items)
                                .set({
                                    lastUpdated: new Date(successItem.newTimestamp), // Update timestamp from server
                                    syncStatus: 'synced', // <-- Mark as synced after successful push
                                })
                                .where(eq(items.id, successItem.id));
                        }
                    }
                    console.log("[Client] Successfully pushed items marked as synced.");
                } catch (updateError) {
                    console.error("[Client] Error updating local status after push:", updateError);
                }
            }
            // Optionally handle pushResult.failed items (e.g., log them, mark them differently)
            if (pushResult.failed && pushResult.failed.length > 0) {
                console.warn(`[Client] ${pushResult.failed.length} items failed to push. They remain 'modified'.`);
            }

        } catch (error) {
            console.error("[Client] PUSH failed:", error);
            console.log("--- Synchronization Partially Failed (Push Failed) ---");
            // Decide if sync should be fully aborted or if we proceed.
            // We'll still update lastSyncTime based on the successful pull/merge attempt.
        }
    } else {
        console.log("[Client] No local changes to push.");
    }

    // 5. Update Last Sync Time (Remains the same - uses start time of sync)
    await saveLastSyncTime(currentSyncStartTime);
    console.log(`--- Synchronization Finished. Next sync after ${new Date(currentSyncStartTime).toISOString()} ---`);
}

// --- Simulation ---
async function runSimulation() {
    console.log("--- Client Simulation ---");
    console.log("Initial Local Items:");
    console.table(await db.select().from(items));
    console.log(`Initial Last Sync Time: ${new Date(await getLastSyncTime()).toISOString()}`);

    // Simulate some offline changes (Ensure syncStatus is set to 'modified')
    console.log("\nSimulating offline changes...");
    const now = new Date();
    try {
        // Add a new item
        const newItemId = `client-item-${Date.now()}`;
        await db.insert(items).values({
            id: newItemId,
            name: 'Newly Added Client Item',
            value: 77,
            lastUpdated: now,
            syncStatus: 'modified', // <-- Mark as modified
        }).onConflictDoNothing();
        console.log(` -> Added new item ${newItemId} (marked modified).`);

        // Modify an existing item
        const existingItem = await db.query.items.findFirst();
        if (existingItem) {
            console.log(` -> Attempting to modify existing item ${existingItem.id} locally.`);
            await db.update(items)
                .set({
                    value: (existingItem.value || 0) + 5,
                    lastUpdated: now,
                    syncStatus: 'modified', // <-- Mark as modified
                })
                .where(eq(items.id, existingItem.id));
            console.log(` -> Modified existing item ${existingItem.id} (marked modified).`);
        } else {
            console.log(" -> No existing local items found to modify.");
        }

        console.log("\nLocal Items After Offline Changes:");
        console.table(await db.select().from(items));

    } catch (err) { console.error("Error during offline simulation:", err); }

    // Run Synchronization
    await synchronize();

    console.log("\nLocal Items After Synchronization:");
    console.table(await db.select().from(items));
    console.log(`Final Last Sync Time: ${new Date(await getLastSyncTime()).toISOString()}`);

    // Simulate a server change (helper function remains same concept)
    console.log("\n--- Simulating server change before next sync ---")
    await dbServerUpdate();

    // Run sync again
    console.log("\n--- Running sync again ---")
    await synchronize();
    console.log("\nLocal Items After Second Synchronization:");
    console.table(await db.select().from(items));
}

// Helper to simulate server change (Remains the same)
async function dbServerUpdate() { /* ... (no changes needed here) ... */
    const sqliteServer = new Database('./db/server.db');
    const dbServer = drizzle(sqliteServer, { schema: { items } });
    try {
        const itemToUpdateOnServer = await dbServer.query.items.findFirst({ where: eq(items.id, 'item-2') })
            ?? await dbServer.query.items.findFirst();
        if (itemToUpdateOnServer) {
            console.log(`[Simulation] Modifying item ${itemToUpdateOnServer.id} on server...`);
            await dbServer.update(items)
                .set({ value: 888, lastUpdated: new Date() })
                .where(eq(items.id, itemToUpdateOnServer.id));
        } else { console.log("[Simulation] No items found on server to modify."); }
    } catch (e) { console.error("[Simulation] Failed to modify server item:", e); }
    finally { sqliteServer.close(); }
}

// Run the simulation
runSimulation();