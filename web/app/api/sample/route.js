import { getSample } from '../../../lib/engine.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await getSample());
  } catch (err) {
    return Response.json({ error: `Could not load sample: ${err.message}` }, { status: 500 });
  }
}
