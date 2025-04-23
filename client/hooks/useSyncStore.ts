// useSyncStore.ts
import { useCallback, useState } from 'react';
import { eq, isNotNull, lt } from 'drizzle-orm';
import { useLastUpdateStore } from './useLastUpdateStore';

type SyncStoreOptions<T> = {
    db: any;
    table: any;
    tableName: string; // Add this!
    api: {
        pullUrl: string;
        pushUrl: string;
    };
};

export function useSyncStore<T extends { id: string; updated_at?: number; deleted_at?: number; status?: string }>(options: SyncStoreOptions<T>) {
    const { db, table, tableName, api } = options;

    const [syncing, setSyncing] = useState(false);
    const { getLastUpdate, setLastUpdate, resetLastUpdate, deviceId } = useLastUpdateStore();

    const sync = useCallback(async (lastsync?: number) => {
        try {
            setSyncing(true);
            const previousSync = lastsync ?? getLastUpdate(tableName);
            const newSyncDate = Date.now();

            // Pull from server
            const serverChanges = await fetch(api.pullUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ last_pull_timestamp: previousSync, device_id: deviceId }),
            })
                .then(res => res.json())
                .then(res => res.data as T[]);

            if (serverChanges?.length) {
                await db.transaction(async (tx: any) => {
                    for (const item of serverChanges) {
                        if (item.deleted_at) {
                            await tx.update(table).set({
                                deleted_at: item.deleted_at,
                                status: 'synced',
                            }).where(eq(table.id, item.id));
                        } else {
                            await tx.insert(table).values(item).onConflictDoUpdate({
                                target: table.id,
                                set: {
                                    ...item,
                                    status: 'synced',
                                },
                                setWhere: item.updated_at ? lt(table.updated_at, item.updated_at) : undefined,
                            });
                        }
                    }
                });
            }

            // Push local pending changes
            const localChanges = await db.select().from(table).where(eq(table.status, 'pending'));

            if (localChanges?.length) {
                const pushResult = await fetch(api.pushUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: localChanges }),
                })
                    .then(res => res.json())
                    .then(res => res as { success: { id: string; new_updated_at: number }[], last_pull_timestamp: number });

                for (const item of pushResult.success) {
                    await db.update(table)
                        .set({
                            status: 'synced',
                            updated_at: item.new_updated_at,
                        })
                        .where(eq(table.id, item.id));
                }
            }

            setLastUpdate(tableName, newSyncDate); // ✅ save per table
        } catch (error) {
            console.error('Error syncing', error);
        } finally {
            setSyncing(false);
        }
    }, [db, table, tableName, api.pullUrl, api.pushUrl, deviceId, getLastUpdate, setLastUpdate]);

    const reset = useCallback(async () => {
        resetLastUpdate(tableName);
        await db.delete(table).where(isNotNull(table.id));
        await sync();
    }, [db, table, sync, tableName, resetLastUpdate]);

    const lastUpdate = getLastUpdate(tableName);

    return {
        sync,
        reset,
        syncing,
        lastUpdate,
        deviceId,
    };
}
