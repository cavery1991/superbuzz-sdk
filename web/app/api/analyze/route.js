import { runAnalyze } from '../../../lib/engine.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { feed, searchTerms } = await req.json();
    if (!feed || typeof feed !== 'string') {
      return Response.json({ error: 'Missing feed content.' }, { status: 400 });
    }
    const report = runAnalyze(feed, searchTerms);
    return Response.json({ report });
  } catch (err) {
    return Response.json({ error: `Could not analyze feed: ${err.message}` }, { status: 422 });
  }
}
