// Address -> county + parcel data for the seller net sheet.
// v2: parcel matched by ADDRESS (not geocode point), Pierce County taxes
// computed from the official 2026 levy rate for the parcel's Tax Area Code,
// plus an allowance for non-levy parcel charges (fire benefit, surface water).
const PIERCE_TCA = require("./pierce_tca.json"); // TCA -> $/1000 (2026 official)
const PIERCE_NONLEVY = 500; // typical non-levy parcel charges estimate

const COUNTY_INFO = {
  "Pierce":    { levy: 0.0105, url: "https://atip.piercecountywa.gov/" },
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

// "13502 OVERLOOK DR E, BONNEY LAKE, WA, 98391" -> "13502 OVERLOOK"
function addrPrefix(matched){
  const street = String(matched||"").split(",")[0].trim();
  const parts = street.split(/\s+/);
  return parts.slice(0, 2).join(" "); // house number + first street word
}

async function queryArcgis(url){
  try{
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return [];
    const data = await res.json();
    return data.features || [];
  }catch(e){ return []; }
}

const PIERCE_BASE = "https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Tax_Parcels/FeatureServer/0/query";
const KING_BASE = "https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/PARCEL_ADDRESS_PUB_AREA_3069/FeatureServer/0/query";

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400",
  };
  try {
    const address = (event.queryStringParameters || {}).address || "";
    if (address.length < 8) return { statusCode: 400, headers, body: JSON.stringify({ error: "address required" }) };

    // 1) Census geocode -> matched address + coords + county/city
    const gUrl = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=" +
      encodeURIComponent(address) +
      "&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties,Incorporated%20Places&format=json";
    const gRes = await fetch(gUrl, { headers: UA });
    const gData = await gRes.json();
    const match = gData?.result?.addressMatches?.[0];
    if (!match) return { statusCode: 200, headers, body: JSON.stringify({ error: "no_match" }) };

    const lon = match.coordinates.x, lat = match.coordinates.y;
    const county = (match.geographies?.Counties?.[0]?.NAME || "").replace(/ County$/i, "");
    const city = match.geographies?.["Incorporated Places"]?.[0]?.NAME || null;
    const info = COUNTY_INFO[county] || null;
    const hn = houseNum(match.matchedAddress);
    const prefix = addrPrefix(match.matchedAddress).replace(/'/g, "''");

    const out = {
      matchedAddress: match.matchedAddress,
      county, city,
      levyRate: info ? info.levy : null,
      assessorUrl: info ? info.url : null,
      parcel: null,
    };

    let features = [], addrField = "", pinField = "", valueOf = null, tcaField = null;
    if (county === "Pierce") {
      addrField = "Site_Address"; pinField = "TaxParcelNumber"; tcaField = "Tax_Area_Code";
      valueOf = a => a.Taxable_Value;
      const flds = "TaxParcelNumber,Site_Address,Taxable_Value,Tax_Area_Code";
      // primary: exact address match; fallback: spatial with buffer
      features = await queryArcgis(PIERCE_BASE + "?where=" + encodeURIComponent(`Site_Address LIKE '${prefix}%'`) +
        `&outFields=${flds}&returnGeometry=false&f=json`);
      if (!features.length)
        features = await queryArcgis(PIERCE_BASE + `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326` +
          `&distance=15&units=esriSRUnit_Meter&outFields=${flds}&returnGeometry=false&f=json`);
    } else if (county === "King") {
      addrField = "ADDR_FULL"; pinField = "PIN";
      valueOf = a => (a.TAX_LNDVAL || 0) + (a.TAX_IMPR || 0);
      const flds = "PIN,ADDR_FULL,TAX_LNDVAL,TAX_IMPR";
      features = await queryArcgis(KING_BASE + "?where=" + encodeURIComponent(`ADDR_FULL LIKE '${prefix}%'`) +
        `&outFields=${flds}&returnGeometry=false&f=json`);
      if (!features.length)
        features = await queryArcgis(KING_BASE + `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326` +
          `&distance=60&outFields=${flds}&returnGeometry=false&f=json`);
    }

    if (features.length) {
      const best = features.find(f => houseNum(f.attributes[addrField]) === hn) || features[0];
      const a = best.attributes;
      const taxable = valueOf(a) || 0;
      let estAnnualTax = null, note = null, tca = tcaField ? String(a[tcaField] || "").trim() : null;

      if (taxable > 0) {
        if (county === "Pierce" && tca && PIERCE_TCA[tca]) {
          const rate = PIERCE_TCA[tca];
          estAnnualTax = Math.round(taxable * rate / 1000 + PIERCE_NONLEVY);
          note = "2026 levy $" + rate.toFixed(2) + "/1k (tax area " + tca + ") + ~$" + PIERCE_NONLEVY + " est. parcel charges";
        } else if (info) {
          estAnnualTax = Math.round(taxable * info.levy);
          note = "county avg levy estimate";
        }
      }
      out.parcel = {
        number: a[pinField] || null,
        siteAddress: a[addrField] || null,
        taxableValue: taxable,
        estAnnualTax, tca, note,
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify(out) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err) }) };
  }
};
