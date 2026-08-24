import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // 303 so the browser follows with GET rather than re-POSTing to "/".
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
