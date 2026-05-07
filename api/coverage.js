// api/coverage.js - Vercel Serverless Function
const KML_URL = 'https://www.google.com/maps/d/u/0/kml?mid=1EcJ7dHbkaN5IJ6AzGDLTL-RPs6niewc&forcekml=1';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    if (req.method === 'OPTIONS') return res.status(204).end();
    try {
        const resp = await fetch(KML_URL, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml,text/xml,*/*' },
                          signal: AbortSignal.timeout(12000)
                            });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const kmlText = await resp.text();
        res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
        return res.status(200).send(kmlText);
    } catch (err) {
        return res.status(502).json({ error: 'Gagal mengambil coverage: ' + err.message });
    }
};
