// Address -> county + parcel data for the seller net sheet.
// Census geocoder (free, no key) -> county + coords; Pierce & King County
// public ArcGIS layers -> parcel number + taxable value. Tax estimated as
// taxable value x county average levy rate (assessor link provided to verify).

const COUNTY_INFO = {
  "Pierce":    { levy: 0.0103, url: "https://atip.piercecountywa.gov/" },
  "King":      { levy: 0.0085, url: "https://blue.kingcounty.com/Assessor/eRealProperty/default.aspx" },
  "Snohomish": { levy: 0.0095, url: "https://wa-snohomish.publicaccessnow.com/PropertyInformation/PropertySearch.aspx" },
  "Thurston":  { levy: 0.0100, url: "https://tcproperty.co.thurston.wa.us/propsql/front.asp" },
  "Kitsap":    { levy: 0.0095, url: "https://psearch.kitsap.gov/psearch/" },
  "Spokane":   { levy: 0.0105, url: "https://cp.spokanecounty.org/scout/propertyinformation/" },
  "Clark":     { levy: 0.0100, url: "https://gis.clark.wa.gov/gishome/property/" },
  "Lewis":     { levy: 0.0095, url: "https://parcels.lewiscountywa.gov/" },
};

const UA = { "User-Agent": "RSLendingNetSheet/1.0 (rslending.co)" };

function houseNum(s){ const m = String(s||"").trim().match(/^\d+/); return m ? m[0] : ""; }

async function queryArcgis(url){
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.features || []);
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400",
  };
  try {
    const address = (event.queryStringParameters || {}).address || "";
    if (address.length < 8) return { statusCode: 400, headers, body: JSON.stringify({ error: "address required" }) };

    // 1) Census geocode -> coords + county (+ city when available)
    const gUrl = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=" +
      encodeURIComponent(address) +
      "&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties,Incorporated%20Places&format=json";
    const gRes = await fetch(gUrl, { headers: UA });
    const gData = await gRes.json();
    const match = gData?.result?.addressMatches?.[0];
    if (!match) return { statusCode: 200, headers, body: JSON.stringify({ error: "no_match" }) };

    const lon = match.coordinates.x, lat = match.coordinates.y;
    const countyFull = match.geographies?.Counties?.[0]?.NAME || "";
    const county = countyFull.replace(/ County$/i, "");
    const city = match.geographies?.["Incorporated Places"]?.[0]?.NAME || null;
    const info = COUNTY_INFO[county] || null;
    const hn = houseNum(match.matchedAddress);

    const out = {
      matchedAddress: match.matchedAddress,
      county, city,
      levyRate: info ? info.levy : null,
      assessorUrl: info ? info.url : null,
      parcel: null,
    };

    // 2) Parcel lookup where we have a working county layer
    let features = null, addrField = "", valueOf = null, pinField = "";
    if (county === "Pierce") {
      const u = "https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Tax_Parcels/FeatureServer/0/query" +
        `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&distance=15&units=esriSRUnit_Meter` +
        "&outFields=TaxParcelNumber,Site_Address,Taxable_Value&returnGeometry=false&f=json";
      features = await queryArcgis(u);
      addrField = "Site_Address"; pinField = "TaxParcelNumber";
      valueOf = a => a.Taxable_Value;
    } else if (county === "King") {
      const u = "https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/PARCEL_ADDRESS_PUB_AREA_3069/FeatureServer/0/query" +
        `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&distance=60` +
        "&outFields=PIN,ADDR_FULL,TAX_LNDVAL,TAX_IMPR&returnGeometry=false&f=json";
      features = await queryArcgis(u);
      addrField = "ADDR_FULL"; pinField = "PIN";
      valueOf = a => (a.TAX_LNDVAL || 0) + (a.TAX_IMPR || 0);
    }

    if (features && features.length) {
      // prefer the feature whose site address starts with the same house number
      let best = features.find(f => houseNum(f.attributes[addrField]) === hn) || features[0];
      const a = best.attributes;
      const taxable = valueOf(a) || 0;
      out.parcel = {
        number: a[pinField] || null,
        siteAddress: a[addrField] || null,
        taxableValue: taxable,
        estAnnualTax: info && taxable > 0 ? Math.round(taxable * info.levy) : null,
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify(out) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err) }) };
  }
};
