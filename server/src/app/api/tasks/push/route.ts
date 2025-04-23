import { db } from "@/db/db";
import { tasks } from "@/db/schema";
import { handlePush } from "@/lib/syncHandlers";

import { NextRequest } from "next/server";

type Task = typeof tasks.$inferSelect;

export async function POST(req: NextRequest) {
    const body: { data: Task[] } = await req.json();

    try {
        const result = await handlePush({
            db,
            table: tasks,
            data: body.data,
        });

        return Response.json({
            success: result.success,
            message: "Data pushed successfully",
        });
    } catch (error: any) {
        return Response.json({ error: error.message }, { status: 400 });
    }
}
