// api/countries.js
// Serverless Function untuk Vercel - Proxy ke City-State-Country API (gratis, tanpa API Key)

export default async function handler(req, res) {
    // Hanya izinkan method GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const url = 'https://city-state-country.vercel.app/countries';

        console.log('📡 Fetching countries from City-State-Country API...');

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ API Error ${response.status}:`, errorText);
            return res.status(response.status).json({
                error: `Gagal mengambil data dari City-State-Country API: ${response.status}`,
                details: errorText,
            });
        }

        const data = await response.json();

        // Mapping ke format yang kompatibel dengan frontend (seperti REST Countries)
        const mappedData = data.map((item) => ({
            name: {
                common: item.name,
                official: item.native || item.name, // fallback
            },
            // Frontend menggunakan properti `flag` untuk menampilkan bendera
            flag: item.emoji || '🏳️',
            flags: {
                svg: item.emoji || '',
                png: item.emoji || '',
                alt: `Flag of ${item.name}`,
            },
            capital: item.capital || 'N/A',
            region: item.region || 'Unknown',
            subregion: item.subregion || 'Unknown',
            population: 0, // API tidak menyediakan populasi
            area: 0,
            languages: [], // API tidak menyediakan languages
            currencies: item.currency ? [item.currency_name || item.currency] : [],
            continents: [], // API tidak menyediakan continents
            maps: '',
            timezones: item.timezones || [],
            independent: true,
            unMember: false,
            // Informasi tambahan (opsional)
            cca2: item.iso2,
            cca3: item.iso3,
            phone_code: item.phone_code,
            native: item.native,
            translations: item.translations || {},
            latitude: item.latitude,
            longitude: item.longitude,
        }));

        console.log(`✅ Successfully fetched and mapped ${mappedData.length} countries`);

        // Cache di CDN selama 1 jam
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

        return res.status(200).json(mappedData);
    } catch (error) {
        console.error('❌ Internal error:', error);
        return res.status(500).json({
            error: 'Terjadi kesalahan internal saat memproses request',
            message: error.message,
        });
    }
}