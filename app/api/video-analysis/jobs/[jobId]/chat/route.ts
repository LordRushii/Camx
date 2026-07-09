import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await context.params;
    const body = await request.json();
    const response = await fetch(`http://localhost:3001/video/jobs/${jobId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      if (errorData && errorData.ok === false) {
        return NextResponse.json(errorData, { status: response.status });
      }
      return NextResponse.json(
        { ok: false, errorCode: "INTERNAL_ERROR", message: "Failed to query chat on worker" },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, errorCode: "INTERNAL_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
