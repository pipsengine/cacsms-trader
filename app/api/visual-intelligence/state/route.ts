export const runtime = 'nodejs';

import { listCaptures, listEvents } from '@/lib/visual-intelligence-store';

export async function GET(): Promise<Response> {
  try {
    const [captures, events] = await Promise.all([
      listCaptures(25),
      listEvents('0', 50),
    ]);

    return Response.json(
      {
        ok: true,
        captures,
        events: events.slice(-25),
        streamUrl: '/api/visual-intelligence/stream',
        captureIngestionUrl: '/api/visual-intelligence/captures',
        capabilities: {
          ingestion: ['upload', 'screenshot', 'broker_snapshot', 'chart_stream_frame'],
          preprocessing: ['normalization', 'chart_area_detection', 'axis_metadata', 'contrast_enhancement'],
          detections: ['candles', 'swings', 'liquidity', 'order_blocks', 'bos', 'choch', 'mss', 'market_phase'],
          decisions: ['BUY', 'SELL', 'WAIT', 'AVOID'],
          persistence: true,
          realTimeEvents: true,
          modelReady: ['OpenCV', 'YOLO', 'ViT', 'ONNX', 'PyTorch', 'TensorFlow'],
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load visual intelligence state.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
