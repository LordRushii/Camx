import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const response = await fetch("http://localhost:3001/video/jobs", {
      method: "POST",
      body: formData,
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      if (errorData && errorData.ok === false) {
        return NextResponse.json(errorData, { status: response.status });
      }
      return NextResponse.json(
        { ok: false, errorCode: "INTERNAL_ERROR", message: "Failed to start job on worker" },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, errorCode: "INTERNAL_ERROR", message },
      { status: 500 }
    );
  }
}
