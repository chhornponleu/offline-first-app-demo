import { db } from '@/db/db';
import { tasks } from '@/db/schema';
import { useSyncStore } from '@/hooks/useSyncStore';
import { desc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Button, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';

type Task = typeof tasks.$inferSelect;


// const baseapiendpoint = 'http://localhost:3000 ';
const baseapiendpoint = 'http://192.168.31.120:3000';

export default function HomeScreen() {
    const data = useLiveQuery(db.select().from(tasks).orderBy(desc(tasks.created_at)),);
    const [editing, setEditing] = useState<Task>();
    const [input, setInput] = useState<string>('');
    // useEffect(() => {
    //     setLastUpdate(0)
    // }, [])
    // const [syncing, setSyncing] = useState(false);

    const { sync, reset, syncing, lastUpdate, deviceId } = useSyncStore({
        db,
        table: tasks,
        tableName: 'tasks', // <-- important!
        api: {
            pullUrl: `${baseapiendpoint}/api/tasks/pull`,
            pushUrl: `${baseapiendpoint}/api/tasks/push`,
        },
    });

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
