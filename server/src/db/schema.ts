import { real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";

export function createId() {
    return v7();
}

const auditFields = {
    created_at: real("created_at").notNull().$defaultFn(() => Date.now()),
    updated_at: real("updated_at").notNull().$defaultFn(() => Date.now()).$onUpdateFn(() => Date.now()),
    deleted_at: real("deleted_at"),

    created_by: text("created_by"),
    updated_by: text("updated_by"),
    deleted_by: text("deleted_by"),
};

export const tasks = sqliteTable("tasks", {
    id: text("id").primaryKey().$default(() => `usr-${createId()}`),
    title: text("full_name"),
    description: text("description"),
    status: text("status").$default(() => "synced").$onUpdate(() => "synced"),
    ...auditFields,
})