import { NextRequest, NextResponse } from "next/server";

// Note: This endpoint now provides cache status information only
// The actual cache is managed in-memory in the main news route
// and cannot be directly cleared from here due to serverless architecture

export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: "Cache status endpoint",
    note: "News cache is now managed in-memory per serverless function instance",
    info: "Each function instance maintains its own cache for warm starts",
    refresh: "To force a refresh, call /api/news?refresh=true",
  });
}

export async function DELETE(request: NextRequest) {
  return NextResponse.json({
    message: "Cache cannot be directly cleared in serverless environment",
    info: "Each function instance has its own in-memory cache",
    solution: "Use /api/news?refresh=true to bypass cache on next request",
  });
}
