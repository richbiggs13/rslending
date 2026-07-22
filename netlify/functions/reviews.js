// Pulls live ratings + recent review quotes for both LOs.
// Experience.com: parsed from each profile's JSON-LD (no API key needed).
// Google: activates automatically when env vars are set in Netlify:
//   GOOGLE_PLACES_KEY, RICHARD_PLACE_ID, STEVEN_PLACE_ID
const PROFILES = [
  {
    key: "richard",
    name: "Richard Bigelow",
    url: "https://www.experience.com/reviews/richard-bigelow-126162",
    placeId: "ChIJo-C9cfH7kFQRvw2mhfGItG0",
  },
  {
    key: "steven",
    name: "Steven Wright",
    url: "https://www.experience.com/reviews/steven-wright-126161",
    placeId: "ChIJjywdTA77kFQR_Aw0SlcS2Qs",
  },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchExperience(profile) {
  const res = await fetch(profile.url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Experience.com ${res.status}`);
  const html = await res.text();

  const ldMatch = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/
  );
  let rating = null, count = null, quotes = [];
  if (ldMatch) {
    try {
      const flat = ldMatch[1];
      const agg = flat.match(/"aggregateRating":\{[^}]*\}/);
      if (agg) {
        const rv = agg[0].match(/"ratingValue":([\d.]+)/);
        const rc = agg[0].match(/"reviewCount":(\d+)/);
        rating = rv ? parseFloat(rv[1]) : null;
        count = rc ? parseInt(rc[1]) : null;
      }
      // pull review bodies + authors; skip auto-generated placeholders
      const revRe = /"reviewBody":"((?:[^"\\]|\\.)*)"[\s\S]{0,400}?"author":\{[^}]*"name":"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = revRe.exec(flat)) && quotes.length < 8) {
        const body = JSON.parse('"' + m[1] + '"');
        const author = JSON.parse('"' + m[2] + '"');
        if (/received a review with/i.test(body)) continue;
        if (body.length < 30) continue;
        quotes.push({ body: body.slice(0, 320), author });
      }
    } catch (e) { /* leave partial data */ }
  }
  return { rating, count, quotes };
}

async function fetchGoogle(profile) {
  const key = process.env.GOOGLE_PLACES_KEY;
  const placeId = profile.placeId;
  if (!key || !placeId) return null;
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total&key=${key}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== "OK") return null;
  return {
    rating: data.result.rating ?? null,
    count: data.result.user_ratings_total ?? null,
  };
}

exports.handler = async () => {
  try {
    const out = {};
    for (const p of PROFILES) {
      const [exp, goog] = await Promise.all([
        fetchExperience(p).catch(() => ({ rating: null, count: null, quotes: [] })),
        fetchGoogle(p).catch(() => null),
      ]);
      out[p.key] = { name: p.name, experience: exp, google: goog };
    }
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
      body: JSON.stringify(out),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
