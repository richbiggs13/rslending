// Returns the latest 30-yr fixed conforming national average rate.
// Source: Optimal Blue Mortgage Market Index (OBMMIC30YF) via FRED — the same
// index as the Daily Rate Watch email. Cached 6 hours at the CDN.
exports.handler = async () => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=21600",
  };
  async function tFetch(url, opts, ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ac.signal }); }
    finally { clearTimeout(t); }
  }
  const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "text/csv,text/plain,*/*" };
  const errs = [];

  // Primary: FRED daily OBMMI 30-yr conforming
  try {
    const start = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const res = await tFetch(
      "https://fred.stlouisfed.org/graph/fredgraph.csv?id=OBMMIC30YF&cosd=" + start,
      { headers: UA }, 6000
    );
    if (!res.ok) throw new Error("FRED " + res.status);
    const rows = (await res.text()).trim().split("\n").slice(1)
      .map(l => l.split(","))
      .filter(([, v]) => v && !isNaN(parseFloat(v)));
    if (!rows.length) throw new Error("FRED no data");
    const [asOf, v] = rows[rows.length - 1];
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ rate: parseFloat(v), asOf, source: "OBMMI 30-yr conforming (FRED)" }),
    };
  } catch (e) { errs.push(String(e)); }

  // Fallback: Freddie Mac weekly PMMS (CDN-hosted CSV)
  try {
    const res = await tFetch("https://www.freddiemac.com/pmms/docs/PMMS_history.csv", { headers: UA }, 6000);
    if (!res.ok) throw new Error("PMMS " + res.status);
    const lines = (await res.text()).trim().split("\n");
    for (let i = lines.length - 1; i > 0; i--) {
      const cols = lines[i].split(",");
      const v = parseFloat(cols[1]);
      if (!isNaN(v) && v > 1 && v < 15) {
        const d = new Date(cols[0]);
        const asOf = isNaN(d) ? cols[0] : d.toISOString().slice(0, 10);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ rate: v, asOf, source: "Freddie Mac PMMS weekly avg" }),
        };
      }
    }
    throw new Error("PMMS no data");
  } catch (e) { errs.push(String(e)); }

  return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: errs.join(" | ") }) };
};
