import { runPredict } from '../../../lib/engine.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { feed, query, threshold } = await req.json();
    if (!feed || !query) {
      return Response.json({ error: 'Need both feed and query.' }, { status: 400 });
    }
    const result = runPredict(feed, String(query), threshold ? Number(threshold) : 0.45);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: `Prediction failed: ${err.message}` }, { status: 422 });
  }
}
