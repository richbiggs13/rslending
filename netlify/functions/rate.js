// Returns the latest 30-yr fixed conforming national average rate.
// Source: Optimal Blue Mortgage Market Index (OBMMIC30YF) via FRED — the same
// index as the Daily Rate Watch email. Cached 6 hours at the CDN.
exports.handler = async () => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=21600",
  };
  try {
    const start = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const res = await fetch(
      "https://fred.stlouisfed.org/graph/fredgraph.csv?id=OBMMIC30YF&cosd=" + start,
      { headers: { "User-Agent": "RSLendingSite/1.0 (rslending.co)" } }
    );
    if (!res.ok) throw new Error("FRED " + res.status);
    const rows = (await res.text()).trim().split("\n").slice(1)
      .map(l => l.split(","))
      .filter(([, v]) => v && !isNaN(parseFloat(v)));
    if (!rows.length) throw new Error("no data");
    const [asOf, v] = rows[rows.length - 1];
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ rate: parseFloat(v), asOf, source: "OBMMI 30-yr conforming (FRED)" }),
    };
  } catch (err) {
    return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: String(err) }) };
  }
};
