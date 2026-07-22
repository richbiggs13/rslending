// Fetches the RS Lending YouTube uploads feed server-side (no CORS issues, no API key)
// and returns the latest videos as JSON. Cached at the edge for 10 minutes.
const CHANNEL_ID = "UCqa3weSeiPUwYKgW10c02sw";

exports.handler = async () => {
  try {
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`
    );
    if (!res.ok) throw new Error(`Feed returned ${res.status}`);
    const xml = await res.text();

    const decode = (s) =>
      s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
      const e = m[1];
      const pick = (re) => (e.match(re) || [])[1] || "";
      const id = pick(/<yt:videoId>(.*?)<\/yt:videoId>/);
      return {
        id,
        title: decode(pick(/<title>([\s\S]*?)<\/title>/)),
        published: pick(/<published>(.*?)<\/published>/),
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      };
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=600",
      },
      body: JSON.stringify({ videos }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
