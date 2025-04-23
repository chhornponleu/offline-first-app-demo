import { db } from '@/db/db';
import { tasks } from '@/db/schema';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { desc, eq, gt, isNotNull, lt, or } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Button, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware'

type Task = typeof tasks.$inferSelect;

const useLastUpdate = create<{
    deviceId: string;
    lastUpdate: number;
    setLastUpdate: (lastUpdate: number) => void;
}>()(
    persist(
        (set) => ({
            deviceId: Date.now().toString(),
            lastUpdate: 1,
            setLastUpdate: (lastUpdate: number) => set(() => ({ lastUpdate })),
        }),
        {
            name: 'meta-sync-tasks-state', // name of the item in the storage (must be unique)
            storage: createJSONStorage(() => AsyncStorage)
        }
    )
)

// const baseapiendpoint = 'http://localhost:3000 ';
const baseapiendpoint = 'http://192.168.31.120:3000';

export default function HomeScreen() {
    const { lastUpdate, setLastUpdate, deviceId } = useLastUpdate();
    const data = useLiveQuery(db.select().from(tasks).orderBy(desc(tasks.created_at)),);
    const [editing, setEditing] = useState<Task>();
    const [input, setInput] = useState<string>('');
    // useEffect(() => {
    //     setLastUpdate(0)
    // }, [])
    const [syncing, setSyncing] = useState(false);

    async function sync(lastsync?: number) {
        try {
            setSyncing(true)
            let newSyncDate = Date.now();

            // pull
            const pullUrl = baseapiendpoint + '/api/tasks/pull';
            const serverChanges = await fetch(pullUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    last_pull_timestamp: lastsync,
                    device_id: deviceId,
                }),
            })
                .then((res) => res.json())
                .then((data) => data.data as typeof tasks.$inferSelect[])

            if (serverChanges && serverChanges.length) {
                console.log('server Changes', serverChanges);
                await db.transaction(async (tx) => {
                    for (const task of serverChanges) {
                        if (task.deleted_at) {
                            await tx.update(tasks)
                                .set({
                                    deleted_at: task.deleted_at,
                                    status: 'synced',
                                })
                                .where(eq(tasks.id, task.id));
                        }
                        else {
                            await tx.insert(tasks)
                                .values(task)
                                .onConflictDoUpdate({
                                    target: tasks.id,
                                    set: {
                                        ...task,
                                        status: 'synced',
                                    },
                                    setWhere: task.updated_at ? lt(tasks.updated_at, task.updated_at) : undefined,
                                })
                        }
                    }

                });
            }
            else {
                console.log('no server changes');
            }

            // push
            const pushUrl = baseapiendpoint + '/api/tasks/push';
            const localChanges = await db.select().from(tasks).where(eq(tasks.status, 'pending'));
            if (localChanges && localChanges.length) {
                console.log('localChanges', JSON.stringify(localChanges));
                const { success } = await fetch(pushUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        data: localChanges,
                    }),
                })
                    .then((res) => res.json())
                    .then((res) => {
                        console.log('push response', res);

                        return res as {
                            success: { id: string; new_updated_at: number }[],
                            last_pull_timestamp: number,
                        }
                    });
                for (const task of success) {
                    await db.update(tasks)
                        .set({
                            status: 'synced',
                            updated_at: task.new_updated_at,
                        })
                        .where(eq(tasks.id, task.id));
                }
            }
            else {
                console.log('no local changes');
            }
            setLastUpdate(newSyncDate);
            console.log(`--- Synchronization Finished. Next sync after ${new Date(newSyncDate).toISOString()} ---`);
        }
        catch (error) {
            console.log('Error syncing', error);
        }
        finally {
            setSyncing(false);
        }
    }

    async function reset() {
        await setLastUpdate(0);
        console.log(await db.delete(tasks).where(isNotNull(tasks.id)));
        sync()
    }

    return (
        <View style={{ flex: 1 }}>
            <Stack.Screen
                options={{
                    headerRight: () => (
                        <View style={{ flexDirection: 'row', columnGap: 12, }}>
                            <Button
                                title="Reset"
                                disabled={syncing}
                                onPress={reset}
                            />
                            <Button
                                title="Sync"
                                disabled={syncing}
                                onPress={async () => {
                                    await sync(lastUpdate);
                                }}
                            />
                        </View>
                    ),
                    headerTitle: 'Tasks',
                }}
            />
            {lastUpdate ? <Text>last sync: {lastUpdate}, id: {deviceId}</Text> : null}
            <View style={{ flexDirection: 'row', paddingHorizontal: 16, backgroundColor: '#efefef' }}>
                <TextInput
                    value={input}
                    onChangeText={setInput}
                    placeholder="Task Title"
                    style={{ flex: 1, paddingVertical: 10 }}
                />
                <Button
                    title={editing ? 'Update' : 'Add'}
                    disabled={!input}
                    onPress={async () => {
                        if (editing) {
                            await db.update(tasks)
                                .set({
                                    title: input,
                                    status: 'pending',
                                    updated_by: deviceId,
                                })
                                .where(eq(tasks.id, editing.id));
                            setEditing(undefined);
                        }
                        else {
                            await db.insert(tasks).values({
                                title: input,
                                description: 'Description',
                                updated_by: deviceId,
                                status: 'pending',
                            });
                        }
                        setInput('');
                        sync(lastUpdate);
                    }}
                />
            </View>

            <FlatList
                data={data.data}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        onPress={() => {
                            setEditing(item);
                            setInput(item.title || '');
                        }}
                        onLongPress={async () => {
                            await db.update(tasks)
                                .set({
                                    deleted_at: Date.now(),
                                    updated_by: deviceId,
                                    status: 'pending',
                                })
                                .where(eq(tasks.id, item.id));
                            sync(lastUpdate);
                        }}
                    >
                        <View style={{ margin: 10, padding: 10, borderWidth: 1, borderColor: 'black', backgroundColor: item.deleted_at ? 'red' : undefined }}>
                            <Text>{item.title}</Text>
                            <Text>{item.description}</Text>
                            <Text>status:{item.status}</Text>
                            {item.created_at ? <Text>created:{new Date(item.created_at).toLocaleString()}</Text> : null}
                            {item.updated_at ? <Text>updated{new Date(item.updated_at).toLocaleString()}-{item.updated_at}</Text> : null}
                            {item.deleted_at ? <Text>deleted{new Date(item.deleted_at).toLocaleString()}-{item.deleted_at}</Text> : null}
                        </View>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={{ margin: 20 }}>No tasks found</Text>}
            />
        </View>
    );
}
