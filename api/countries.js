// api/countries.js
// Serverless Function untuk Vercel - Proxy ke REST Countries API v5

export default async function handler(req, res) {
    // Hanya izinkan method GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Ambil API Key dari environment variable
    const API_KEY = process.env.REST_COUNTRIES_API_KEY;

    if (!API_KEY) {
        console.error('REST_COUNTRIES_API_KEY tidak ditemukan di environment variables');
        return res.status(500).json({
            error: 'Konfigurasi API key tidak ditemukan. Silakan set REST_COUNTRIES_API_KEY di Vercel Environment Variables.'
        });
    }

    try {
        const url = 'https://api.restcountries.com/countries/v5/all';

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`API Error ${response.status}:`, errorText);
            return res.status(response.status).json({
                error: `Gagal mengambil data dari REST Countries API: ${response.status}`,
                details: errorText,
            });
        }

        const data = await response.json();

        // Cache di CDN selama 1 jam
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

        return res.status(200).json(data);

    } catch (error) {
        console.error('Internal error:', error);
        return res.status(500).json({
            error: 'Terjadi kesalahan internal saat memproses request',
            message: error.message,
        });
    }
}