import { db } from "@/db/db";
import { tasks } from "@/db/schema";
import { eq, lt } from "drizzle-orm";
import { NextRequest } from "next/server";

type Task = typeof tasks.$inferSelect;

/**
 * [POST]/api/tasks/push
 * body: {
 *   data: Task[] 
 * }
 * @param req 
 * @returns 
 */
export async function POST(req: NextRequest) {
    const body: { data: Task[] } = await req.json();
    const {
        data,
    } = body;

    if (!data || !data.length) {
        return Response.json({ error: "No data provided" }, { status: 400 });
    }

    const serverNow = Date.now();

    console.log('pushing data', JSON.stringify(data, null, 2));

    const result = await db.transaction(async (tx) => {
        const result: { id: string; new_updated_at: number }[] = []
        for (const task of data) {
            if (task.deleted_at) {
                await tx.update(tasks)
                    .set({
                        ...task,
                        updated_by: task.updated_by,
                        deleted_at: task.deleted_at,  // keeplocal delete
                        status: 'synced',
                        updated_at: serverNow,
                    })
                    .where(eq(tasks.id, task.id));
            }
            else {
                const [serverTask] = await tx.select()
                    .from(tasks)
                    .where(eq(tasks.id, task.id))
                    .limit(1);

                if (serverTask) {
                    if (serverTask.updated_at < task.updated_at) {
                        await tx.update(tasks)
                            .set({
                                ...task,
                                status: 'synced',
                                updated_at: serverNow,
                            })
                            .where(eq(tasks.id, task.id));
                    }
                    else {
                        // conflict
                        console.log('conflict', task, serverTask);
                    }
                }
                else {
                    await db.insert(tasks)
                        .values({
                            ...task,
                            status: 'synced',
                            updated_at: serverNow,
                        })
                }
            }
            result.push({
                id: task.id,
                new_updated_at: serverNow,
            })
        }
        return result;
    });

    return Response.json({
        success: result,
        message: "Data pushed successfully",
    })
}