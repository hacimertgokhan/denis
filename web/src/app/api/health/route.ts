import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ping } from "@/lib/denis/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const [denis, postgres] = await Promise.all([
    ping(),
    db
      .execute(sql`select 1`)
      .then(() => true)
      .catch(() => false),
  ]);
  const healthy = denis && postgres;
  return NextResponse.json({ ok: healthy, denis, postgres }, { status: healthy ? 200 : 503 });
}
