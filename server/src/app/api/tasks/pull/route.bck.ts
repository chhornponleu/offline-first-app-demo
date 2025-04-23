import { db } from "@/db/db";
import { tasks } from "@/db/schema";
import { and, gt, ne } from "drizzle-orm";
import { NextRequest } from "next/server";

type Task = typeof tasks.$inferSelect;

/**
 * [POST]/api/tasks/pull
 * body: {
 *   last_pull_timestamp: number | undefined
 * }
 * @returns 
 */
export async function POST(req: NextRequest) {
    const body: { last_pull_timestamp: number, device_id?: string } = await req.json();
    const {
        last_pull_timestamp,
        device_id
    } = body;

    console.log(last_pull_timestamp);

    const serverChanged = await db
        .select()
        .from(tasks)
        .where(
            and(
                last_pull_timestamp
                    ? gt(tasks.updated_at, last_pull_timestamp)
                    : undefined,
                (device_id && last_pull_timestamp) ? ne(tasks.updated_by, device_id) : undefined
            )
        )

    console.log('pulled data', JSON.stringify(serverChanged, null, 2));


    return Response.json({
        data: serverChanged,
        serverChanged: serverChanged.length > 0,
    })
}