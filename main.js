import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, log } from 'crawlee';

// Initialize (Works locally and on Apify)
await Actor.init();

// --- INPUT CONFIGURATION (Compatible with GitHub Actions) ---
// On GitHub, we read from "Environment Variables" instead of the Apify Dashboard
const keyword = process.env.SEARCH_KEYWORD || 'Need house'; 
const country = process.env.SEARCH_COUNTRY || 'US';

log.info(`🚀 SEARCHING FOR: "${keyword}" in "${country}"`);

const startUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(keyword)}&search_type=keyword_unordered`;

// Helper: Recursive Search (The Universal Finder)
function findValue(obj, targetKeys) {
    if (!obj || typeof obj !== 'object') return null;
    for (const key of targetKeys) {
        if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
    }
    for (const key in obj) {
        if (typeof obj[key] === 'object') {
            const found = findValue(obj[key], targetKeys);
            if (found) return found;
        }
    }
    return null;
}

const crawler = new PlaywrightCrawler({
    headless: true,
    maxConcurrency: 1, 
    // On GitHub, we use the default browser settings
    requestHandlerTimeoutSecs: 180,

    requestHandler: async ({ page, request }) => {
        log.info(`Processing: ${request.url}`);
        const adMap = new Map();

        // 1. LISTENER
        page.on('response', async (response) => {
            if (response.url().includes('/api/graphql/') && response.request().method() === 'POST') {
                try {
                    const json = await response.json();
                    const edges = findValue(json, ['edges']);
                    
                    if (edges && Array.isArray(edges) && edges.length > 0) {
                        log.info(`⚡ Packet caught: Scanning ${edges.length} potential ads...`);
                        for (const edge of edges) {
                            const node = edge.node || edge;
                            if (node) {
                                const name = findValue(node, ['pageName', 'page_name', 'name', 'title']) || 'N/A';
                                const body = findValue(node, ['ad_creative_body', 'caption', 'body', 'text']) || 'N/A';
                                const link = findValue(node, ['ad_creative_link_url', 'link_url', 'cta_url']) || 'N/A';
                                const id = findValue(node, ['ad_archive_id', 'id']) || Math.random().toString(36).substring(7);
                                const dateRaw = findValue(node, ['ad_delivery_start_date', 'creation_time']);
                                let dateStr = dateRaw ? new Date(dateRaw * 1000).toDateString() : 'N/A';
                                const platforms = findValue(node, ['publisher_platforms']) || ['Facebook'];

                                if (name !== 'N/A' || body !== 'N/A') {
                                    if (!adMap.has(id)) {
                                        adMap.set(id, {
                                            "Ads Runner Name": name,
                                            "Social Platforms": Array.isArray(platforms) ? platforms.join(', ') : 'Facebook',
                                            "Ads Summary": body,
                                            "Ad Link": link,
                                            "Active Since": dateStr,
                                            "Search Keyword": keyword,
                                            "Ad ID": id
                                        });
                                    }
                                }
                            }
                        }
                    }
                } catch (err) { }
            }
        });

        // 2. NAVIGATE
        await page.goto(request.url, { waitUntil: 'domcontentloaded' });

        // 3. SCROLL
        log.info('Scrolling 15 times to fetch 50+ leads...');
        for (let i = 1; i <= 15; i++) {
            await page.evaluate(() => window.scrollBy(0, 1500));
            await new Promise(r => setTimeout(r, 2000));
            if (i % 5 === 0) log.info(`...Scrolled ${i}/15 times. Leads found: ${adMap.size}`);
        }

        // 4. SAVE (This saves to storage/datasets/default locally)
        const results = Array.from(adMap.values());
        if (results.length > 0) {
            log.info(`✅ FINAL RESULT: Extracted ${results.length} Valid Leads!`);
            await Dataset.pushData(results);
        } else {
            log.warning('⚠️ No ads found.');
        }
    },
});

await crawler.run([startUrl]);
await Actor.exit();
