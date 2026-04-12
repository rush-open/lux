export async function GET(request: Request) {
  const url = new URL(request.url);
  const streamId = url.searchParams.get('streamId');

  if (!streamId) {
    return Response.json({ error: 'streamId required' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', streamId })}\n\n`)
      );
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
