import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

const client = openDatabaseSync('sqlite.db', { enableChangeListener: true });
export const db = drizzle(client);

