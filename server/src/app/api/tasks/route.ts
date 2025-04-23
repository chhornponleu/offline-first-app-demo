import { db } from "@/db/db";
import { tasks } from "@/db/schema";

export async function GET() {
    const data = await db.select().from(tasks);
    return Response.json({
        data,
    });
}