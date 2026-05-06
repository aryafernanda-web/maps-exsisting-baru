// ============================================================
//  api/notion.js
//  Vercel Serverless Function — ambil data pelanggan dari Notion
//  Support: direct lat/lng, Maps URL (pendek & panjang)
//  Filter: ambil SEMUA baris yang punya koordinat valid
// ============================================================

const { Client } = require('@notionhq/client');

// ── Helper: ambil nilai properti Notion (Mendukung Rollup, Files, dll) ──
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
        case 'formula':
            const f = prop.formula;
            return f?.string || f?.number || f?.boolean || f?.date?.start || null;
        case 'rollup':
            if (prop.rollup?.array) {
                return prop.rollup.array.map(v => getPropValue(v)).filter(x => x !== null).join(', ');
            }
            const r = prop.rollup;
            return r?.number || r?.string || r?.date?.start || null;
        case 'files':
            return prop.files?.map(f => f.file?.url || f.external?.url).filter(Boolean).join(', ') || null;
        default: return null;
    }
}

// ── Ekstrak koordinat dari URL atau teks apapun ──────────────
function extractCoords(text) {
    if (!text || typeof text !== 'string') return null;
    
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch(e) {}
    
    let m = decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    
    m = decoded.match(/(?:@|[?&]q=|ll=)(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    
    m = decoded.match(/(-?\d{1,2}\.\d+)[,\s]+(-?\d{2,3}\.\d+)/);
    if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            return { lat, lng };
        }
    }
    
    return null;
}

// ── Resolve URL pendek secara cerdas ───────────────────────
async function resolveShortUrl(url, timeoutMs = 6000) {
    try {
        const res = await fetch(url, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            redirect: 'manual',
            timeout: timeoutMs
        });
        
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location');
            if (location) {
                const coords = extractCoords(location);
                if (coords) return coords;
                
                const continueMatch = location.match(/[?&]continue=([^&]+)/);
                if (continueMatch) {
                    const coords2 = extractCoords(decodeURIComponent(continueMatch[1]));
                    if (coords2) return coords2;
                }
                
                if (location.startsWith('http')) {
                    return await resolveShortUrl(location, timeoutMs - 1000);
                }
            }
        }
        return extractCoords(res.url);
    } catch (e) {
        return null;
    }
}

// ── Ambil semua halaman dari Notion (pagination) ─────────────
async function fetchAllPages(notion, databaseId, startTime) {
    const pages = [];
    let cursor;
    do {
        const resp = await notion.databases.query({
            database_id: databaseId,
            start_cursor: cursor,
            page_size: 100,
            filter: {
                property: "Status",
                status: {
                    equals: "Costumer"
                }
            }
        });
        pages.push(...resp.results);
        cursor = resp.has_more ? resp.next_cursor : undefined;
        
        // Timeout protection (Max ~6.5 detik untuk paginasi karena Vercel Hobby = 10s)
        if (cursor && (Date.now() - startTime > 6500)) {
            console.log("⚠️ Waktu paginasi hampir habis (>6.5s), menghentikan fetch baris berikutnya.");
            break;
        }
    } while (cursor);
    return pages;
}

// ── Main Handler (Vercel Format) ─────────────────────────────
module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // --- MODE POST: RESOLVE URL BATCH ---
    if (req.method === 'POST') {
        try {
            const batch = req.body;
            if (!Array.isArray(batch)) throw new Error('Invalid payload');
            
            const resolved = [];
            const startTime = Date.now();
            
            const results = await Promise.allSettled(
                batch.map(async (item) => {
                    const elapsed = Date.now() - startTime;
                    const timeLeft = 8500 - elapsed;
                    if (timeLeft <= 0) return null;
                    
                    const resolveTimeout = Math.min(timeLeft, 2500);
                    const coords = await resolveShortUrl(item.mapsUrl, resolveTimeout);
                    
                    if (coords) {
                        return { ...item, lat: coords.lat, lng: coords.lng };
                    }
                    return null;
                })
            );
            
            for (const r of results) {
                if (r.status === 'fulfilled' && r.value) resolved.push(r.value);
            }
            
            return res.status(200).json(resolved);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // --- MODE GET: FETCH DARI NOTION ---
    const NOTION_API_KEY     = process.env.NOTION_API_KEY;
    const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

    if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
        return res.status(500).json({ error: 'NOTION_API_KEY atau NOTION_DATABASE_ID belum diset' });
    }

    const notion = new Client({ auth: NOTION_API_KEY });
    const startTime = Date.now();

    try {
        console.log('📡 Mengambil semua halaman dari Notion...');
        const pages = await fetchAllPages(notion, NOTION_DATABASE_ID, startTime);
        console.log(`✅ Total baris: ${pages.length}`);

        const locations  = [];
        const needResolve = [];

        // Statistik
        let totalCustomers = 0;
        let mappedCustomers = 0;
        let blankCustomers = 0;

        for (const page of pages) {
            const props = page.properties;
            const data = { id: page.id, nama: '(Tanpa Nama)', status: '', alamat: '', telepon: '', coverage: '', paket: '', lat: null, lng: null, mapsUrl: null };

            // ── Agresif Scanner: Cek SEMUA kolom untuk mencari data yang relevan ──
            for (const [key, prop] of Object.entries(props)) {
                const val = getPropValue(prop);
                if (val === null || val === '') continue;
                const lowKey = key.toLowerCase();
                const strVal = String(val).trim();

                // 1. Identifikasi Nama
                if (['nama', 'name', 'costumer', 'customer', 'pelanggan'].some(k => lowKey.includes(k))) {
                    if (data.nama === '(Tanpa Nama)') data.nama = strVal;
                }
                // 2. Identifikasi Lat/Lng (Kolom khusus)
                if (lowKey.includes('lat') && !isNaN(parseFloat(val)) && data.lat === null) data.lat = parseFloat(val);
                if ((lowKey.includes('lng') || lowKey.includes('long')) && !isNaN(parseFloat(val)) && data.lng === null) data.lng = parseFloat(val);
                
                // 3. Identifikasi Maps URL atau Link
                if (strVal.startsWith('http') || strVal.includes('http')) {
                    if (lowKey.includes('map') || lowKey.includes('lokasi') || lowKey.includes('link') || lowKey.includes('url') || lowKey.includes('alamat')) {
                        if (data.mapsUrl === null) {
                            // Ekstrak URL murni (menghilangkan spasi atau kurung markdown)
                            const urlMatch = strVal.match(/https?:\/\/[^\s)\]"]+/);
                            if (urlMatch) data.mapsUrl = urlMatch[0];
                        }
                    }
                }
                
                // 4. Metadata lainnya
                if (lowKey === 'status') data.status = strVal;
                if (lowKey.includes('alamat') || lowKey.includes('address')) data.alamat = strVal;
                if (lowKey.includes('telp') || lowKey.includes('phone') || lowKey.includes('telepon')) data.telepon = strVal;
                if (lowKey.includes('coverage')) data.coverage = strVal;
                if (lowKey.includes('paket')) data.paket = strVal;

                // 5. Deep Scan: Jika baris ini punya teks yang mengandung koordinat, ambil!
                if (data.lat === null || data.lng === null) {
                    const coords = extractCoords(strVal);
                    if (coords) { data.lat = coords.lat; data.lng = coords.lng; }
                }
            }

            // FILTER: Hanya proses jika status mengandung 'costumer' atau 'customer'
            const isCustomer = data.status.toLowerCase().includes('costumer') || data.status.toLowerCase().includes('customer');
            if (isCustomer) {
                totalCustomers++;
                // Simpan jika punya lokasi
                if (data.lat !== null && data.lng !== null) {
                    locations.push(data);
                    mappedCustomers++;
                } else if (data.mapsUrl) {
                    needResolve.push(data);
                    mappedCustomers++;
                } else {
                    blankCustomers++;
                }
            }
        }

        console.log(`📍 Total Costumer: ${totalCustomers}, Punya Map: ${mappedCustomers}, Kosong: ${blankCustomers}`);

        return res.status(200).json({ locations, needResolve, stats: { totalCustomers, mappedCustomers, blankCustomers } });

    } catch (err) {
        console.error('❌ Error:', err);
        const msg = err.code === 'unauthorized'
            ? 'NOTION_API_KEY tidak valid'
            : err.code === 'object_not_found'
            ? 'NOTION_DATABASE_ID tidak ditemukan'
            : err.message;
        return res.status(500).json({ error: msg });
    }
};
