import { runAnalyze, fetchFeedFromUrl } from '../../../lib/engine.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { feed, url, searchTerms } = await req.json();
    let feedText = feed;
    if (!feedText && url) feedText = await fetchFeedFromUrl(url);
    if (!feedText || typeof feedText !== 'string') {
      return Response.json({ error: 'Provide a feed file or a feed URL.' }, { status: 400 });
    }
    const report = runAnalyze(feedText, searchTerms);
    // Return the resolved feed text so the client can run per-query predictions.
    return Response.json({ report, feed: feedText });
  } catch (err) {
    return Response.json({ error: `Could not analyze feed: ${err.message}` }, { status: 422 });
  }
}
