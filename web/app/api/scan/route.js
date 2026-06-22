import { runScan } from '../../../lib/engine.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { url, html } = await req.json();
    let pageHtml = html;
    let sourceUrl = url;
    if (!pageHtml && url) {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 ShopGraphBot' } });
      if (!res.ok) return Response.json({ error: `Fetch failed: HTTP ${res.status}` }, { status: 422 });
      pageHtml = await res.text();
    }
    if (!pageHtml) return Response.json({ error: 'Provide a URL or pasted HTML.' }, { status: 400 });
    const result = runScan(pageHtml, sourceUrl);
    if (result.error) return Response.json({ error: result.error }, { status: 422 });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: `Scan failed: ${err.message}` }, { status: 422 });
  }
}
