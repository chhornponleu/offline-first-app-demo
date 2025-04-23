// lastUpdateStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface LastUpdateState {
    deviceId: string;
    lastUpdates: Record<string, number>;
    getLastUpdate: (key: string) => number;
    setLastUpdate: (key: string, value: number) => void;
    resetLastUpdate: (key: string) => void;
}

export const useLastUpdateStore = create<LastUpdateState>()(
    persist(
        (set, get) => ({
            deviceId: Date.now().toString(),
            lastUpdates: {},
            getLastUpdate: (key) => get().lastUpdates[key] ?? 0,
            setLastUpdate: (key, value) => set((state) => ({
                lastUpdates: {
                    ...state.lastUpdates,
                    [key]: value,
                }
            })),
            resetLastUpdate: (key) => set((state) => {
                const updated = { ...state.lastUpdates };
                delete updated[key];
                return { lastUpdates: updated };
            }),
        }),
        {
            name: 'last-update-storage',
            storage: {
                getItem: async (key) => {
                    const value = await AsyncStorage.getItem(key);
                    return value ? JSON.parse(value) : null;
                },
                setItem: async (key, value) => {
                    await AsyncStorage.setItem(key, JSON.stringify(value));
                },
                removeItem: async (key) => {
                    await AsyncStorage.removeItem(key);
                },
            },
        }
    )
);
