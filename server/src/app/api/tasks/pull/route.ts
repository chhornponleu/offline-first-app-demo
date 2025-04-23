import { db } from "@/db/db";
import { tasks } from "@/db/schema";
import { handlePull } from "@/lib/syncHandlers";

import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
    const body: { last_pull_timestamp: number; device_id?: string } = await req.json();

    const result = await handlePull({
        db,
        table: tasks,
        last_pull_timestamp: body.last_pull_timestamp,
        device_id: body.device_id,
    });

    return Response.json(result);
}