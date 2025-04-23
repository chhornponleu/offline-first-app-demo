// lib/syncHandler.ts
import { and, eq, gt, ne } from 'drizzle-orm';

interface SyncPullOptions<T> {
    db: any;
    table: any;
    last_pull_timestamp: number | undefined;
    device_id?: string;
}

interface SyncPushOptions<T> {
    db: any;
    table: any;
    data: T[];
    device_id?: string;
}

export async function handlePull<T>({ db, table, last_pull_timestamp, device_id }: SyncPullOptions<T>) {
    const conditions = [];

    if (last_pull_timestamp) {
        conditions.push(gt(table.updated_at, last_pull_timestamp));
    }

    if (device_id) {
        conditions.push(ne(table.updated_by, device_id));
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const serverChanges = await db.select().from(table).where(whereCondition);

    return {
        data: serverChanges,
        serverChanged: serverChanges.length > 0,
    };
}

export async function handlePush<T extends { id: string; updated_at: number; deleted_at: number | null }>({
    db,
    table,
    data,
    device_id
}: SyncPushOptions<T>) {
    if (!data?.length) {
        throw new Error('No data provided');
    }

    const serverNow = Date.now();

    const result = await db.transaction(async (tx: any) => {
        const response: { id: string; new_updated_at: number }[] = [];

        for (const item of data) {
            if (item.deleted_at) {
                await tx.update(table)
                    .set({
                        deleted_at: item.deleted_at,
                        status: 'synced',
                        updated_at: serverNow,
                        updated_by: device_id, // set updated_by
                        deleted_by: device_id, // set deleted_by
                    })
                    .where(eq(table.id, item.id));
            } else {
                const [existing] = await tx.select().from(table).where(eq(table.id, item.id)).limit(1);

                if (existing) {
                    if (existing.updated_at < item?.updated_at) {
                        await tx.update(table)
                            .set({
                                ...item,
                                status: 'synced',
                                updated_at: serverNow,
                                updated_by: device_id, // set updated_by
                            })
                            .where(eq(table.id, item.id));
                    } else {
                        console.log('conflict detected', { item, existing });
                    }
                } else {
                    await tx.insert(table).values({
                        ...item,
                        status: 'synced',
                        updated_at: serverNow,
                        updated_by: device_id, // set updated_by
                    });
                }
            }
            response.push({
                id: item.id,
                new_updated_at: serverNow,
            });
        }

        return response;
    });

    return {
        success: result,
        serverNow,
    };
}
