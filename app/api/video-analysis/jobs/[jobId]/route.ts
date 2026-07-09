import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await context.params;
    const response = await fetch(`http://localhost:3001/video/jobs/${jobId}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      if (errorData && errorData.ok === false) {
        return NextResponse.json(errorData, { status: response.status });
      }
      return NextResponse.json(
        { ok: false, errorCode: "INTERNAL_ERROR", message: "Failed to get job from worker" },
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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await context.params;
    const response = await fetch(`http://localhost:3001/video/jobs/${jobId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      if (errorData && errorData.ok === false) {
        return NextResponse.json(errorData, { status: response.status });
      }
      return NextResponse.json(
        { ok: false, errorCode: "INTERNAL_ERROR", message: "Failed to clear job on worker" },
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
