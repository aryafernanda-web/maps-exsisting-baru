// api/notion.js - Vercel Serverless Function
const path = require('path');
const fs   = require('fs');

function getPropValue(prop) {
      if (!prop) return null;
      switch (prop.type) {
        case 'title':        return prop.title?.map(t => t.plain_text).join('') || null;
        case 'rich_text':    return prop.rich_text?.map(t => t.plain_text).join('') || null;
        case 'number':       return prop.number ?? null;
        case 'select':       return prop.select?.name || null;
        case 'status':       return prop.status?.name || null;
        case 'multi_select': return prop.multi_select?.map(s => s.name).join(', ') || null;
        case 'url':          return prop.url || null;
        case 'phone_number': return prop.phone_number || null;
        case 'email':        return prop.email || null;
        case 'checkbox':     return prop.checkbox;
        case 'date':         return prop.date?.start || null;
        case 'formula': { const f = prop.formula; return f?.string || f?.number || f?.boolean || f?.date?.start || null; }
        case 'rollup': {
                      if (prop.rollup?.array) return prop.rollup.array.map(v => getPropValue(v)).filter(x => x !== null).join(', ');
                      const r = prop.rollup; return r?.number || r?.string || r?.date?.start || null;
        }
        case 'files': return prop.files?.map(f => f.file?.url || f.external?.url).filter(Boolean).join(', ') || null;
        default: return null;
      }
}
function extractCoords(text) {
              if (!text || typeof text !== 'string') return null;
      let decoded = text;
      try { decoded = decodeURIComponent(text); } catch(e) {}
      let m = decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
      if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
      m = decoded.match(/(?:@|[?&]q=|ll=)(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
      m = decoded.match(/(-?\d{1,2}\.\d+)[,\s]+(-?\d{2,3}\.\d+)/);
      if (m) { const lat = parseFloat(m[1]), lng = parseFloat(m[2]); if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng }; }
      return null;
}
async function resolveShortUrl(url, timeoutMs = 5000) {
      try {
                const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
                if (res.status >= 300 && res.status < 400) {
                              const location = res.headers.get('location');
                              if (location) { const coords = extractCoords(location); if (coords) return coords; }
                }
                return extractCoords(res.url || url);
      } catch (e) { return null; }
}
function processPage(page) {
      const props = page.properties || {};
              const data  = { id: page.id, nama: '(module.exports = async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') return res.status(204).end();

    if (req.method === 'POST') {
              try {
                            const batch = req.body;
                            if (!Array.isArray(batch)) throw new Error('Invalid payload');
                            const startTime = Date.now();
                            const results = await Promise.allSettled(batch.map(async (item) => {
                                              if (Date.now() - startTime > 8000) return null;
                                              const coords = await resolveShortUrl(item.mapsUrl, 3000);
                                              return coords ? { ...item, lat: coords.lat, lng: coords.lng } : null;
                            }));
                            return res.status(200).json(results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value));
              } catch (e) { return res.status(500).json({ error: e.message }); }
    }

    try {
              const dumpPaths = [path.join(process.cwd(), 'notion_dump.json'), path.join(__dirname, '..', 'notion_dump.json')];
              let pages = null;
              for (const dumpPath of dumpPaths) {
                            if (fs.existsSync(dumpPath)) {
                                              console.log('Reading notion_dump.json from: ' + dumpPath);
                                              const raw = fs.readFileSync(dumpPath, 'utf8');
                                              const json = JSON.parse(raw);
                                              pages = json.results || json;
                                              break;
                            }
              }
              if (!pages) {
                            const NOTION_API_KEY = process.env.NOTION_API_KEY || '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';
                            const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '29edcd14e2c880ddb393dc9f54758a18';
                            const { Client } = require('@notionhq/client');
                            const notion = new Client({ auth: NOTION_API_KEY });
                            const resp = await notion.databases.query({ database_id: NOTION_DATABASE_ID, page_size: 100, filter: { property: 'Status', status: { equals: 'Costumer' } } });
                            pages = resp.results;
              }
              const locations = [], needResolve = [];
              let totalCustomers = 0, blankCustomers = 0;
              for (const page of pages) {
                                 const data = processPage(page);
                            const isCustomer = data.status.toLowerCase().includes('costumer') || data.status.toLowerCase().includes('customer');
                            if (!isCustomer) continue;
                            totalCustomers++;
                            if (data.lat !== null && data.lng !== null) { locations.push(data); }
                            else if (data.mapsUrl) { needResolve.push(data); }
                            else { blankCustomers++; }
              }
              return res.status(200).json({ locations, needResolve, stats: { totalCustomers, mappedCustomers: locations.length + needResolve.length, blankCustomers } });
    } catch (err) {
              console.error('Error:', err);
              return res.status(500).json({ error: err.message });
    }
};
