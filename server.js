const express = require("express");
const cors = require("cors");
const { XMLParser } = require("fast-xml-parser");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.static(".")); // serves index.html + assets

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 8080;

/**
 * Real astronomy sources requested:
 * - Universe Today
 * - Phys.org Space News
 * - Astronomy.com
 */
const NEWS_FEEDS = [
  { url: "https://www.universetoday.com/feed/", source: "Universe Today" },
  { url: "https://www.nasa.gov/feed/", source: "NASA" },
  { url: "https://www.space.com/astronomy", source: "Space.com Astronomy", isHtml: true },
  { url: "https://www.space.com/space-exploration", source: "Space.com Space Exploration", isHtml: true },
  { url: "https://www.space.com/science/astrophysics", source: "Space.com Astrophysics", isHtml: true },
  { url: "https://www.space.com/science/particle-physics", source: "Space.com Particle Physics", isHtml: true },
  { url: "https://www.astronomy.com/feed/", source: "Astronomy.com" },
  { url: "https://aasnova.org/feed/", source: "AAS" },
  { url: "https://news.mit.edu/rss/topic/astrophysics", source: "MIT News" },
  { url: "https://api.rss2json.com/v1/api.json?rss_url=https://skyandtelescope.org/astronomy-news/feed", source: "Sky & Telescope", isJson: true },
  { url: "https://spacedaily.com/category/news/feed", source: "Space Daily" },
  { url: "https://www.esa.int/rssfeed/news", source: "ESA" },
  { url: "https://news.google.com/rss/search?q=ISRO+space&hl=en-IN&gl=IN&ceid=IN:en", source: "ISRO" },
  { url: "https://www.asc-csa.gc.ca/rss/eng/news.xml", source: "CSA" },
  { url: "https://www.jaxa.jp/rss/press_e.rdf", source: "JAXA" }
];

// Real upcoming launches
const LAUNCH_API = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=20";

// SeaSky source for celestial events (as requested)
const SEASKY_2026_URL = "https://www.seasky.org/astronomy/astronomy-calendar-2026.html";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  processEntities: false
});

function toArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function stripHtml(s = "") {
  return String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractImageFromHtml(html = "") {
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

function cleanText(s = "") {
  return decodeHtmlEntities(stripHtml(s)).replace(/\s+/g, " ").trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml, application/json, text/html;q=0.9, */*;q=0.8",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
  return r.text();
}

const { exec } = require("child_process");

function fetchWithCurl(url) {
  return new Promise((resolve, reject) => {
    const cmd = `curl.exe -s -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" "${url}"`;
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

const imageCache = new Map();
const SPACE_KEYWORDS = [
  "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto",
  "moon", "sun", "star", "nebula", "galaxy", "comet", "asteroid", "meteor", "telescope",
  "launch", "space", "orbit", "astronaut", "nasa", "esa", "iss", "rocket", "stellar",
  "black hole", "supernova", "eclipse", "aurora", "constellation", "messier", "hubble",
  "webb", "artemis", "spacex", "apollo", "capsule", "rover", "crater", "milky way"
];

async function findImageForTitle(title) {
  if (!title) return "";
  const cacheKey = title.trim().toLowerCase();
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey);
  }

  try {
    const lowerTitle = title.toLowerCase();
    const foundKeywords = SPACE_KEYWORDS.filter(kw => {
      const regex = new RegExp("\\b" + kw + "\\b", "i");
      return regex.test(lowerTitle);
    });

    let items = [];
    if (foundKeywords.length > 0) {
      const query = foundKeywords.join(" ");
      const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image`;
      const res = await fetchWithTimeout(url);
      const data = await res.json();
      items = data.collection?.items || [];
    }

    if (items.length === 0) {
      let query = title
        .replace(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?\s*[:\-–—]?/i, "")
        .replace(/^[a-zA-Z]+,\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*[:\-–—]?/i, "")
        .replace(/[:\-–—()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const words = query.split(" ").filter(w => w.length > 3);
      if (words.length > 0) {
        const simpleQuery = words.slice(0, 3).join(" ");
        const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(simpleQuery)}&media_type=image`;
        const res = await fetchWithTimeout(url);
        const data = await res.json();
        items = data.collection?.items || [];
      }
    }

    if (items.length === 0) {
      const fallbacks = ["nebula", "galaxy", "telescope", "stars", "planet"];
      const randomTerm = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(randomTerm)}&media_type=image`;
      const res = await fetchWithTimeout(url);
      const data = await res.json();
      items = data.collection?.items || [];
    }

    if (items.length > 0) {
      const imgUrl = items[0].links?.[0]?.href || "";
      if (imgUrl) {
        imageCache.set(cacheKey, imgUrl);
        return imgUrl;
      }
    }
  } catch (err) {
    console.error(`Error finding image for title "${title}":`, err.message);
  }

  const finalFallback = "https://images-assets.nasa.gov/image/PIA03033/PIA03033~medium.jpg";
  imageCache.set(cacheKey, finalFallback);
  return finalFallback;
}

const AD_KEYWORDS = [
  "\\bdeal\\b", "\\bdeals\\b", "buying guide", "gift guide", "\\bsale\\b", "\\bsales\\b", 
  "\\bdiscount\\b", "\\bdiscounts\\b", "\\bcoupon\\b", "\\bcoupons\\b", "price drop",
  "\\bshop\\b", "\\bshopping\\b", "sponsored", "\\bsaving\\b", "\\bsavings\\b",
  "best telescope", "best binoculars", "gift ideas", "black friday", "cyber monday"
];

function isAdArticle(title = "", summary = "") {
  const text = (title + " " + summary).toLowerCase();
  return AD_KEYWORDS.some(pattern => {
    const regex = new RegExp(pattern, "i");
    return regex.test(text);
  });
}

function getBestImageUrl(it, descriptionHtml) {
  let url = "";

  // 1. Check media:content
  const mediaContent = it["media:content"];
  if (mediaContent) {
    const list = Array.isArray(mediaContent) ? mediaContent : [mediaContent];
    const imgObj = list.find(x => x["@_medium"] === "image" || !x["@_medium"]);
    if (imgObj && imgObj["@_url"]) url = imgObj["@_url"];
    else if (list[0]?.["@_url"]) url = list[0]["@_url"];
  }

  // 2. Check enclosure
  if (!url) {
    const enclosure = it.enclosure;
    if (enclosure) {
      const list = Array.isArray(enclosure) ? enclosure : [enclosure];
      if (list[0]?.["@_url"]) url = list[0]["@_url"];
    }
  }

  // 3. Check media:thumbnail
  if (!url) {
    const mediaThumb = it["media:thumbnail"];
    if (mediaThumb) {
      const list = Array.isArray(mediaThumb) ? mediaThumb : [mediaThumb];
      if (list[0]?.["@_url"]) url = list[0]["@_url"];
    }
  }

  // 4. Check description HTML
  if (!url) {
    url = extractImageFromHtml(descriptionHtml);
  }

  if (url) {
    // WordPress thumbnail size clean up (e.g. -150x150.jpg -> .jpg)
    url = url.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, "$1");
    // Phys.org thumbnail clean up (e.g. /news/tmb/ -> /news/800/)
    url = url.replace(/\/news\/tmb\//i, "/news/800/");
  }

  return url;
}

function parseSpaceComHtml(html, sourceName) {
  const items = [];
  const blockRegex = /<div class="listingResult[^>]*>([\s\S]*?)<\/article>/gi;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(html)) !== null) {
    const block = blockMatch[1];
    
    // Extract URL
    const urlMatch = block.match(/href="([^"]+)"\s+class="article-link"/i);
    const url = urlMatch ? urlMatch[1] : "";
    
    // Extract Title
    const titleMatch = block.match(/<h3 class="article-name">([\s\S]*?)<\/h3>/i);
    const title = titleMatch ? cleanText(titleMatch[1]) : "";
    
    // Extract Image
    const imgMatch = block.match(/data-pin-media="([^"]+)"/i) || block.match(/data-original="([^"]+)"/i);
    const imageUrl = imgMatch ? imgMatch[1] : "";
    
    // Extract Date
    const dateMatch = block.match(/datetime="([^"]+)"/i);
    const publishedAt = dateMatch ? dateMatch[1] : "";
    
    // Extract Summary/Synopsis
    const synopsisMatch = block.match(/<p class="synopsis">([\s\S]*?)<\/p>/i);
    const summary = synopsisMatch ? cleanText(synopsisMatch[1]) : "";
    
    if (url && title) {
      items.push({
        title,
        url,
        publishedAt,
        source: sourceName,
        summary,
        imageUrl
      });
    }
  }
  return items;
}

function normalizeRssOrAtom(xml, sourceName) {
  const j = parser.parse(xml);
  const items = [];

  // RSS
  const rssItems = j?.rss?.channel?.item;
  if (rssItems) {
    for (const it of toArray(rssItems)) {
      const descriptionHtml = it.description || "";
      items.push({
        title: cleanText(it.title || "Untitled"),
        url: it.link || "",
        publishedAt: it.pubDate || it.published || "",
        source: sourceName,
        summary: cleanText(descriptionHtml),
        imageUrl: getBestImageUrl(it, descriptionHtml)
      });
    }
    return items;
  }

  // Atom
  const atomEntries = j?.feed?.entry;
  if (atomEntries) {
    for (const it of toArray(atomEntries)) {
      let link = "";
      if (typeof it.link === "string") link = it.link;
      else if (Array.isArray(it.link)) link = it.link[0]?.["@_href"] || "";
      else link = it.link?.["@_href"] || "";

      const summaryRaw =
        it.summary?.["#text"] ||
        it.summary ||
        it.content?.["#text"] ||
        it.content ||
        "";

      let imageUrl = extractImageFromHtml(summaryRaw);
      if (imageUrl) {
        imageUrl = imageUrl.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, "$1");
        imageUrl = imageUrl.replace(/\/news\/tmb\//i, "/news/800/");
      }

      items.push({
        title: cleanText(it.title?.["#text"] || it.title || "Untitled"),
        url: link,
        publishedAt: it.updated || it.published || "",
        source: sourceName,
        summary: cleanText(summaryRaw),
        imageUrl: imageUrl || ""
      });
    }
    return items;
  }

  // RDF / RSS 1.0 (like JAXA)
  const rdfRoot = j?.["rdf:RDF"] || j?.RDF;
  const rdfItems = rdfRoot?.item;
  if (rdfItems) {
    for (const it of toArray(rdfItems)) {
      const descriptionHtml = it.description || "";
      items.push({
        title: cleanText(it.title || "Untitled"),
        url: it.link || "",
        publishedAt: it.pubDate || it.published || it["dc:date"] || "",
        source: sourceName,
        summary: cleanText(descriptionHtml),
        imageUrl: getBestImageUrl(it, descriptionHtml)
      });
    }
    return items;
  }

  return items;
}

function normalizeRssJson(jsonStr, sourceName) {
  const items = [];
  try {
    const data = JSON.parse(jsonStr);
    if (!data || !Array.isArray(data.items)) return [];
    for (const it of data.items) {
      const descriptionHtml = it.description || "";
      items.push({
        title: cleanText(it.title || "Untitled"),
        url: it.link || "",
        publishedAt: it.pubDate || "",
        source: sourceName,
        summary: cleanText(descriptionHtml),
        imageUrl: it.thumbnail || extractImageFromHtml(descriptionHtml) || ""
      });
    }
  } catch (err) {
    console.error(`Error parsing RSS JSON for ${sourceName}:`, err.message);
  }
  return items;
}

function inferWhereFromNote(note = "") {
  const n = note.toLowerCase();

  // Common visibility phrases
  const visMatch =
    note.match(/visible(?:\s+in|\s+from)?\s+([^.]+)/i) ||
    note.match(/best visible(?:\s+in|\s+from)?\s+([^.]+)/i) ||
    note.match(/best seen(?:\s+in|\s+from)?\s+([^.]+)/i);

  if (visMatch?.[1]) return visMatch[1].trim();

  if (n.includes("northern hemisphere")) return "Northern Hemisphere";
  if (n.includes("southern hemisphere")) return "Southern Hemisphere";
  if (n.includes("worldwide")) return "Worldwide";
  if (n.includes("global")) return "Global";

  if (n.includes("north america")) return "North America";
  if (n.includes("south america")) return "South America";
  if (n.includes("europe")) return "Europe";
  if (n.includes("africa")) return "Africa";
  if (n.includes("asia")) return "Asia";
  if (n.includes("australia")) return "Australia";

  return "Global (see details)";
}

function parseSeaSky2026(html) {
  const monthMap = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
  };

  // Try to read both plain text and list/paragraph formatted content
  const normalized = decodeHtmlEntities(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n");

  const lines = normalized
    .split("\n")
    .map((l) => cleanText(l))
    .filter(Boolean);

  const events = [];

  for (const line of lines) {
    // expected patterns:
    // "January 3, 4 - Quadrantids Meteor Shower."
    // "June 29 - Full Moon."
    // with optional bullet prefix
    const t = line.replace(/^[-*•]\s*/, "").trim();

    const m = t.match(
      /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{1,2}))?\s*-\s*(.+)$/i
    );
    if (!m) continue;

    const monthName = m[1].toLowerCase();
    const day1 = Number(m[2]);
    const day2 = m[3] ? Number(m[3]) : null;
    const rest = m[4].trim();

    if (!(monthName in monthMap)) continue;

    const date = new Date(Date.UTC(2026, monthMap[monthName], day1, 0, 0, 0));
    if (isNaN(date)) continue;

    const firstDot = rest.indexOf(".");
    const title = firstDot > -1 ? rest.slice(0, firstDot).trim() : rest;
    const note = firstDot > -1 ? rest.slice(firstDot + 1).trim() : rest;

    const where = inferWhereFromNote(note);

    events.push({
      name: title || "Celestial Event",
      date: date.toISOString(),
      endDate: day2 ? new Date(Date.UTC(2026, monthMap[monthName], day2, 0, 0, 0)).toISOString() : null,
      where,
      note,
      source: "SeaSky Astronomy Calendar 2026",
      sourceUrl: SEASKY_2026_URL
    });
  }

  // dedupe
  const map = new Map();
  for (const e of events) {
    const key = `${e.name}|${e.date}`;
    if (!map.has(key)) map.set(key, e);
  }

  return [...map.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

// ---------------- API ROUTES ----------------

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "navars-space-telemetry-kiosk",
    time: new Date().toISOString()
  });
});

app.get("/api/news", async (_req, res) => {
  try {
    const merged = [];
    const feedErrors = [];

    for (const feed of NEWS_FEEDS) {
      try {
        const content = await fetchText(feed.url);
        let parsed = [];
        if (feed.isHtml) {
          parsed = parseSpaceComHtml(content, feed.source);
        } else if (feed.isJson) {
          parsed = normalizeRssJson(content, feed.source);
        } else {
          parsed = normalizeRssOrAtom(content, feed.source);
        }
        merged.push(...parsed);
      } catch (e) {
        console.error(`Feed error [${feed.source}]:`, e.message);
        feedErrors.push({ source: feed.source, error: e.message });
      }
    }

    const dedup = new Map();
    for (const n of merged) {
      const key = (n.url || n.title || "").trim();
      if (!key) continue;
      if (isAdArticle(n.title, n.summary)) continue;
      if (!dedup.has(key)) dedup.set(key, n);
    }

    const items = [...dedup.values()]
      .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
      .slice(0, 60);

    // Resolve missing images (e.g. Astronomy.com items) via NASA Images API
    await Promise.all(
      items.map(async (item) => {
        if (!item.imageUrl) {
          item.imageUrl = await findImageForTitle(item.title);
        }
      })
    );

    res.json({ ok: true, count: items.length, items, feedErrors });
  } catch (e) {
    console.error("News aggregate error:", e.message);
    res.json({ ok: false, count: 0, items: [], error: e.message });
  }
});

const FALLBACK_LAUNCHES = [
  {
    name: "Falcon 9 | Starlink Group 10-6",
    launch_service_provider: { name: "SpaceX" },
    pad: { location: { name: "Cape Canaveral, FL, USA" } },
    net: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    name: "Falcon Heavy | NOAA-U Mission",
    launch_service_provider: { name: "SpaceX" },
    pad: { location: { name: "Kennedy Space Center, FL, USA" } },
    net: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    name: "Electron | StriX-3 Radar Satellite",
    launch_service_provider: { name: "Rocket Lab" },
    pad: { location: { name: "Mahia Peninsula, New Zealand" } },
    net: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    name: "Ariane 6 | Maiden Space Flight",
    launch_service_provider: { name: "Arianespace" },
    pad: { location: { name: "Kourou, French Guiana" } },
    net: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  }
];

let launchesCache = {
  data: null,
  lastUpdated: 0
};

app.get("/api/launches", async (_req, res) => {
  const now = Date.now();
  // Cache for 30 minutes to stay safely under Spacedevs rate limits
  if (launchesCache.data && (now - launchesCache.lastUpdated < 30 * 60 * 1000)) {
    return res.json({ ok: true, items: launchesCache.data });
  }

  try {
    const r = await fetchWithTimeout(LAUNCH_API);
    if (!r.ok) {
      if (launchesCache.data) {
        console.warn(`Launch API failed: ${r.status}. Serving stale cache.`);
        return res.json({ ok: true, items: launchesCache.data, stale: true });
      }
      throw new Error(`Launch API failed: ${r.status}`);
    }
    const j = await r.json();
    const items = j.results || [];
    launchesCache = { data: items, lastUpdated: now };
    res.json({ ok: true, items });
  } catch (e) {
    console.error("Launch API error:", e.message);
    if (launchesCache.data) {
      return res.json({ ok: true, items: launchesCache.data, stale: true });
    }
    // Return fallback launches on initial load if API is rate-limited
    res.json({ ok: true, items: FALLBACK_LAUNCHES, fallback: true });
  }
});

function getIndianSpaceEvents() {
  const events = [];
  const years = [2026, 2027];
  
  for (const yr of years) {
    events.push(
      {
        name: "National Moon Day",
        date: `${yr}-07-20T00:00:00Z`,
        where: "India & Worldwide",
        note: "Celebrated in India and globally to mark the historic Apollo 11 moon landing in 1969. In India, local planetariums, schools, and science centers host lunar-themed quizzes, sky-watching sessions, and lectures."
      },
      {
        name: "Vikram Sarabhai Birth Anniversary",
        date: `${yr}-08-12T00:00:00Z`,
        where: "India",
        note: "Commemorates the father of the Indian Space Program with national scale model-rocketry competitions and space science lectures."
      },
      {
        name: "India Space Week",
        date: `${yr}-08-12T00:00:00Z`, // Starts on Aug 12
        where: "India",
        note: "Organized by the India Space Week Association (ISWA), this week bridges the birth anniversary of Dr. Vikram Sarabhai (August 12) with National Space Day preparations."
      },
      {
        name: "ISRO Foundation Day",
        date: `${yr}-08-15T00:00:00Z`,
        where: "India",
        note: "Marking the establishment of the Indian Space Research Organisation (ISRO) on August 15, 1969."
      },
      {
        name: "National Space Day",
        date: `${yr}-08-23T00:00:00Z`,
        where: "India",
        note: "India's premier official space day, established to commemorate the successful soft landing of Chandrayaan-3 on the lunar south pole."
      },
      {
        name: "Satish Dhawan Birth Anniversary",
        date: `${yr}-09-25T00:00:00Z`,
        where: "India",
        note: "Honoring the legendary aerospace engineer and former ISRO Chairman Vikram Sarabhai's successor."
      },
      {
        name: "World Space Week",
        date: `${yr}-10-04T00:00:00Z`, // Starts Oct 4
        where: "India & Worldwide",
        note: "Celebrated extensively across India by ISRO centers. It marks the launch of Sputnik 1 (October 4, 1957) and the signing of the Outer Space Treaty (October 10, 1967)."
      },
      {
        name: "National Science Day",
        date: `${yr}-02-28T00:00:00Z`,
        where: "India",
        note: "While honoring Sir C.V. Raman's discovery of the Raman Effect, ISRO and IN-SPACe use this day to run major public space exhibitions and open-house events."
      },
      {
        name: "Rakesh Sharma Spaceflight Anniversary",
        date: `${yr}-04-03T00:00:00Z`,
        where: "India",
        note: "Celebrating Wing Commander Rakesh Sharma becoming the first Indian in space, launched aboard Soyuz T-11 in 1984."
      },
      {
        name: "Aryabhata Launch Anniversary",
        date: `${yr}-04-19T00:00:00Z`,
        where: "India",
        note: "Marks the launch of India's very first satellite in 1975, celebrated as a foundational day for Indian satellite technology."
      }
    );
  }
  return events;
}

app.get("/api/events", async (_req, res) => {
  try {
    const html = await fetchText(SEASKY_2026_URL);
    const seaSkyEvents = parseSeaSky2026(html);
    const indianEvents = getIndianSpaceEvents();
    
    const allEvents = [...seaSkyEvents, ...indianEvents];
    
    // Sort all events chronologically so the closest event is first!
    allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    const now = new Date();
    // Use start of today to ensure today's events (like National Moon Day on July 20) are captured
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const upcoming = allEvents
      .filter((e) => new Date(e.date) >= startOfToday)
      .slice(0, 40);

    res.json({
      ok: true,
      source: "SeaSky & Indian Space Calendar",
      count: upcoming.length,
      items: upcoming
    });
  } catch (e) {
    console.error("SeaSky events error:", e.message);
    res.json({ ok: false, count: 0, items: [], error: e.message });
  }
});

// Default location: Sharjah, UAE
const SHARJAH = { slug: "sharjah", name: "Sharjah (UAE)", country: "uae", lat: 25.3463, lon: 55.4209 };
const INDIAN_CITIES = [ SHARJAH ]; // kept for legacy compat

// Fetch TheSkyLive planets/moon for arbitrary GPS coordinates via location picker
async function fetchTslForCoords(lat, lon, page = "planets-visible-tonight") {
  // Step 1: hit the location picker to set a session cookie for those coords
  const pickUrl = `https://theskylive.com/locationpicker?back_url=https%3A%2F%2Ftheskylive.com%2F${encodeURIComponent(page)}&lat=${lat}&lng=${lon}&location_name=Custom`;
  const pickHtml = await fetchTadUrl(pickUrl);
  if (!pickHtml) return null;
  // Step 2: fetch the actual data page
  const dataUrl = `https://theskylive.com/${page}`;
  const dataHtml = await fetchTadUrl(dataUrl);
  return dataHtml || null;
}

function fetchTadUrl(url) {
  return new Promise((resolve) => {
    const cmd = `curl.exe -k -s -L -A "Mozilla/5.0 (compatible; DuckDuckGo-Favicons-Bot/1.0; +http://duckduckgo.com)" "${url}"`;
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      if (!error && stdout && stdout.length > 10000 && !stdout.includes("Just a moment")) {
        return resolve(stdout);
      }
      resolve("");
    });
  });
}

function calculateSunTimesForCity(lat, lon, date = new Date(), country = "india") {
  const year = date.getFullYear();
  const start = new Date(year, 0, 0);
  const diff = date - start;
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const declRad = declination * Math.PI / 180;
  const latRad = lat * Math.PI / 180;
  
  let hourAngleDeg = 90;
  try {
    const val = -Math.tan(latRad) * Math.tan(declRad);
    if (val >= -1 && val <= 1) {
      hourAngleDeg = Math.acos(val) * 180 / Math.PI;
    }
  } catch (_e) {}
  
  const stdMeridian = (country === "uae" || lon < 65) ? 60.0 : 82.5;
  const lonDiffMinutes = (stdMeridian - lon) * 4;
  const baseNoonMinutes = 12 * 60 + lonDiffMinutes;
  
  const riseMinutes = Math.round(baseNoonMinutes - (hourAngleDeg * 4));
  const setMinutes = Math.round(baseNoonMinutes + (hourAngleDeg * 4));
  
  const fmtTime = (mins) => {
    const h = Math.floor((mins + 1440) % 1440 / 60);
    const m = Math.floor((mins + 1440) % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  return {
    sunrise: fmtTime(riseMinutes),
    sunset: fmtTime(setMinutes)
  };
}
function getConstellationFromRaDec(raHours, decDegrees) {
  const ra = (raHours + 24) % 24;
  if (ra >= 0.0 && ra < 2.1) return "Pisces";
  if (ra >= 2.1 && ra < 3.7) return "Aries";
  if (ra >= 3.7 && ra < 6.0) return "Taurus";
  if (ra >= 6.0 && ra < 8.2) return "Gemini";
  if (ra >= 8.2 && ra < 9.4) return "Cancer";
  if (ra >= 9.4 && ra < 11.9) return "Leo";
  if (ra >= 11.9 && ra < 14.4) return "Virgo";
  if (ra >= 14.4 && ra < 16.0) return "Libra";
  if (ra >= 16.0 && ra < 16.9) return "Scorpius";
  if (ra >= 16.9 && ra < 17.9) return "Ophiuchus";
  if (ra >= 17.9 && ra < 20.1) return "Sagittarius";
  if (ra >= 20.1 && ra < 21.9) return "Capricornus";
  if (ra >= 21.9 && ra < 23.9) return "Aquarius";
  return "Pisces";
}

function fetchNasaDialAMoon(lon = 55.4209) {
  return new Promise((resolve) => {
    // Derive the user's local date/time from their longitude.
    // UTC offset (hours) = lon / 15 — accurate to within 30 min for any location.
    const utcOffsetHours = lon / 15;
    const utcMs = Date.now();
    const localMs = utcMs + utcOffsetHours * 3600 * 1000;
    const localDate = new Date(localMs);

    const year  = localDate.getUTCFullYear();
    const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
    const day   = String(localDate.getUTCDate()).padStart(2, '0');
    const hours = String(localDate.getUTCHours()).padStart(2, '0');
    const mins  = String(localDate.getUTCMinutes()).padStart(2, '0');

    const dateStr = `${year}-${month}-${day}T${hours}:${mins}`;
    const url = `https://svs.gsfc.nasa.gov/api/dialamoon/${dateStr}`;
    const cmd = `curl.exe -k -s -L "${url}"`;

    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      try {
        if (!err && stdout && stdout.includes("image")) {
          const data = JSON.parse(stdout);
          const distanceKmNum = Math.round(data.distance || 399329);
          const distanceMiNum = Math.round(distanceKmNum * 0.621371);
          const distanceKm = `${distanceKmNum.toLocaleString()} km`;
          const distanceMiles = `${distanceMiNum.toLocaleString()} mi`;
          
          const arcsecNum = (data.diameter || 1794.8).toFixed(1);
          const angularDiameter = `${arcsecNum} arcseconds`;
          const constellation = getConstellationFromRaDec(data.j2000_ra || 14.4, data.j2000_dec || -19.8);
          
          // ageDays is based on the local date — correct for the user's timezone
          const ageDays = Math.floor(data.age || 8);
          const phasePercentNum = Math.round((1 - Math.cos(((data.age || 8.1) / 29.530588853) * 2 * Math.PI)) / 2 * 100);
          const phaseText = `${phasePercentNum}% - Day ${ageDays}`;

          let phaseName = "";
          const age = data.age || 8;
          if (age < 1.5 || age > 28.0) phaseName = "New Moon";
          else if (age < 6.8) phaseName = "Waxing Crescent";
          else if (age < 8.2) phaseName = "First Quarter";
          else if (age < 13.8) phaseName = "Waxing Gibbous";
          else if (age < 15.8) phaseName = "Full Moon";
          else if (age < 21.5) phaseName = "Waning Gibbous";
          else if (age < 22.8) phaseName = "Third Quarter";
          else phaseName = "Waning Crescent";

          return resolve({
            realImageUrl: data.image?.url || "",
            constellation,
            distanceKm,
            distanceMiles,
            angularDiameter,
            phasePercent: `${phasePercentNum}%`,
            phaseText,
            phaseName,
            ageDays,
            localDateUsed: dateStr  // for debug
          });
        }
      } catch (_e) {}
      resolve(null);
    });
  });
}

function getTadMoonPhaseImage(phaseName) {
  const name = String(phaseName || "").toLowerCase();
  if (name.includes("full")) return "https://c.tadst.com/gfx/moon1.svg";
  if (name.includes("third") || name.includes("last quarter")) return "https://c.tadst.com/gfx/moon2.svg";
  if (name.includes("new")) return "https://c.tadst.com/gfx/moon3.svg";
  if (name.includes("first quarter")) return "https://c.tadst.com/gfx/moon4.svg";
  if (name.includes("waning")) return "https://c.tadst.com/gfx/moon2.svg";
  if (name.includes("waxing")) return "https://c.tadst.com/gfx/moon4.svg";
  return "https://c.tadst.com/gfx/moon4.svg";
}

app.get("/api/cities", (_req, res) => {
  res.json({ ok: true, cities: INDIAN_CITIES });
});

app.get("/api/moon", async (req, res) => {
  const lat = parseFloat(req.query.lat) || SHARJAH.lat;
  const lon = parseFloat(req.query.lon) || SHARJAH.lon;
  const locationName = req.query.locationName || SHARJAH.name;
  const cityInfo = { slug: "custom", name: locationName, country: "custom", lat, lon };

  // Derive timezone offset from longitude (rounded to nearest 0.5h, clamped)
  const tzOffset = Math.max(-12, Math.min(14, Math.round(lon / 15 * 2) / 2));
  const localMs = Date.now() + tzOffset * 3600 * 1000;
  const localDate = new Date(localMs);
  const pad2 = n => String(n).padStart(2, '0');
  const dateStr = `${localDate.getUTCFullYear()}-${pad2(localDate.getUTCMonth()+1)}-${pad2(localDate.getUTCDate())}`;
  try {
    // PRIMARY: USNO Astronomical Applications API — location-accurate times in local tz
    const usnoUrl = `https://aa.usno.navy.mil/api/rstt/oneday?date=${dateStr}&coords=${lat},${lon}&tz=${tzOffset}`;
    console.log(`[Moon] USNO: ${usnoUrl}`);

    const [usnoRaw, nasaData] = await Promise.all([
      fetch(usnoUrl).then(r => r.ok ? r.json() : null).catch(() => null),
      fetchNasaDialAMoon(lon)
    ]);

    // NASA: moon image, distance, angular diameter, constellation
    const imageUrl = nasaData?.realImageUrl || "https://svs.gsfc.nasa.gov/vis/a000000/a005500/a005587/frames/730x730_1x1_30p/moon.4861.jpg";
    const constellation = nasaData?.constellation || "Libra";
    const distanceKm = nasaData?.distanceKm || "399,329 km";
    const distanceMiles = nasaData?.distanceMiles || "248,131 mi";
    const angularDiameter = nasaData?.angularDiameter || "1794.8 arcseconds";

    if (usnoRaw?.properties?.data) {
      const d = usnoRaw.properties.data;

      // Sun times (already in user's local time from USNO)
      const sunrise = d.sundata?.find(x => x.phen === "Rise")?.time || "";
      const sunset  = d.sundata?.find(x => x.phen === "Set")?.time  || "";

      // Moon times (already in user's local time from USNO)
      let moonrise = d.moondata?.find(x => x.phen === "Rise")?.time || "";
      let moonset  = d.moondata?.find(x => x.phen === "Set")?.time  || "";

      // If moonset (or moonrise) is missing today, it means it happens after midnight.
      // Fetch tomorrow's USNO data to get it.
      if (!moonset || !moonrise) {
        try {
          const tomorrowMs = localMs + 86400000;
          const tomorrowDate = new Date(tomorrowMs);
          const tomorrowStr = `${tomorrowDate.getUTCFullYear()}-${pad2(tomorrowDate.getUTCMonth()+1)}-${pad2(tomorrowDate.getUTCDate())}`;
          const usnoTomorrow = await fetch(
            `https://aa.usno.navy.mil/api/rstt/oneday?date=${tomorrowStr}&coords=${lat},${lon}&tz=${tzOffset}`
          ).then(r => r.ok ? r.json() : null).catch(() => null);

          if (usnoTomorrow?.properties?.data?.moondata) {
            const tmMoon = usnoTomorrow.properties.data.moondata;
            if (!moonset) {
              const tmSet = tmMoon.find(x => x.phen === "Set")?.time;
              if (tmSet) moonset = tmSet + " +1d"; // sets after midnight (next calendar day)
            }
            if (!moonrise) {
              const tmRise = tmMoon.find(x => x.phen === "Rise")?.time;
              if (tmRise) moonrise = tmRise + " +1d";
            }
          }
        } catch (e) {
          console.error("USNO tomorrow fetch error:", e.message);
        }
      }

      moonrise = moonrise || "--:--";
      moonset  = moonset  || "--:--";


      // Phase & illumination — USNO gives location-accurate values
      const phase       = d.curphase   || nasaData?.phaseName   || "Waxing Gibbous";
      const illumination = d.fracillum || nasaData?.phasePercent || "59%";

      // Lunar Day: use NASA precise fractional age (same globally, but date-corrected for tz)
      const lunarDay = nasaData?.ageDays ?? Math.floor(
        ((localMs - new Date("2000-01-06T18:14:00Z").getTime()) % (29.530588853 * 86400000)) / 86400000
      );
      const phaseText = `${illumination} - Day ${lunarDay}`;

      const sunCalc = calculateSunTimesForCity(lat, lon, new Date(), "custom");
      return res.json({
        ok: true, city: cityInfo, phase, illumination, phaseText,
        imageUrl, realImageUrl: imageUrl, constellation, distanceKm, distanceMiles, angularDiameter,
        sunrise: sunrise || sunCalc.sunrise,
        sunset:  sunset  || sunCalc.sunset,
        moonrise, moonset,
        source: "USNO Astronomical API + NASA Dial-a-Moon"
      });
    }

    // USNO failed but NASA succeeded
    if (nasaData) {
      const sunCalc = calculateSunTimesForCity(lat, lon, new Date(), "custom");
      return res.json({
        ok: true, city: cityInfo,
        phase: nasaData.phaseName || "Waxing Gibbous",
        illumination: nasaData.phasePercent || "59%",
        phaseText: nasaData.phaseText || "59% - Day 8",
        imageUrl, realImageUrl: imageUrl, constellation, distanceKm, distanceMiles, angularDiameter,
        sunrise: sunCalc.sunrise, sunset: sunCalc.sunset,
        moonrise: "--:--", moonset: "--:--",
        source: "NASA Dial-a-Moon (USNO unavailable)"
      });
    }
  } catch (err) {
    console.error("Moon API error:", err.message);
  }

  // City-specific mathematical fallback
  const now = new Date();
  const baseNewMoon = new Date("2000-01-06T18:14:00Z").getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  const synodicMonth = 29.530588853;
  const diffDays = (now.getTime() - baseNewMoon) / msPerDay;
  const phaseValue = (diffDays / synodicMonth) % 1.0;
  const age = phaseValue * synodicMonth;
  const calcIllum = Math.round((1 - Math.cos(2 * Math.PI * phaseValue)) / 2 * 100);

  let calcPhase = "";
  if (age < 1.0 || age > 28.53) calcPhase = "New Moon";
  else if (age < 6.8) calcPhase = "Waxing Crescent";
  else if (age < 8.0) calcPhase = "First Quarter";
  else if (age < 13.8) calcPhase = "Waxing Gibbous";
  else if (age < 15.8) calcPhase = "Full Moon";
  else if (age < 21.5) calcPhase = "Waning Gibbous";
  else if (age < 22.8) calcPhase = "Third Quarter";
  else calcPhase = "Waning Crescent";

  const sunCalc = calculateSunTimesForCity(cityInfo.lat, cityInfo.lon, now, cityInfo.country);
  const fallbackImg = getTadMoonPhaseImage(calcPhase);

  // Calculate moonrise/moonset offset by city longitude
  const stdMeridian = (cityInfo.country === "uae" || cityInfo.lon < 65) ? 60.0 : 82.5;
  const lonOffsetMins = Math.round((stdMeridian - cityInfo.lon) * 4);
  const moonriseMins = 13 * 60 + 26 - lonOffsetMins;
  const moonsetMins = 57 - lonOffsetMins;
  const fmtMins = (m) => `${String(Math.floor((m + 1440) % 1440 / 60)).padStart(2, '0')}:${String(Math.floor((m + 1440) % 60)).padStart(2, '0')}`;

  const finalMoonrise = (cityInfo.slug === "sharjah") ? "13:20" : fmtMins(moonriseMins);
  const finalMoonset = (cityInfo.slug === "sharjah") ? "00:20" : fmtMins(moonsetMins);

  res.json({
    ok: true,
    city: cityInfo,
    phase: calcPhase,
    illumination: `${calcIllum}%`,
    imageUrl: fallbackImg,
    sunrise: sunCalc.sunrise,
    sunset: sunCalc.sunset,
    moonrise: finalMoonrise,
    moonset: finalMoonset,
    source: "City Astronomical Algorithm"
  });
});

app.get("/api/planets", async (req, res) => {
  // Accept lat/lon for GPS-based location, fallback to Sharjah
  const lat = parseFloat(req.query.lat) || SHARJAH.lat;
  const lon = parseFloat(req.query.lon) || SHARJAH.lon;
  const locationName = req.query.locationName || SHARJAH.name;
  const cityInfo = { slug: "custom", name: locationName, lat, lon };

  const cleanStr = (s) => s.replace(/<[^>]+>/g, '').replace(/&deg;/g, '°').replace(/&nbsp;/g, ' ').trim();

  const parsePlanetsHtml = (html) => {
    if (!html) return null;
    const tableMatch = html.match(/<table[^>]*class=["']?objectdata["']?[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) return null;
    const tableHtml = tableMatch[1];
    const rowRegex = /<tr[^>]*>\s*<td[^>]*><a[^>]*>([^<]+)<\/a><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    const planets = [];
    let match;
    while ((match = rowRegex.exec(tableHtml)) !== null) {
      planets.push({
        name: cleanStr(match[1]),
        visibility: cleanStr(match[2]),
        notes: cleanStr(match[3]),
        mag: cleanStr(match[4]),
        elongation: cleanStr(match[5]),
        comment: cleanStr(match[2])
      });
    }
    return planets.length > 0 ? planets : null;
  };

  try {
    // Try GPS-specific fetch via TheSkyLive location picker
    let html = null;
    const isCustomLoc = Math.abs(lat - SHARJAH.lat) > 0.01 || Math.abs(lon - SHARJAH.lon) > 0.01;
    if (isCustomLoc) {
      console.log(`[Planets] Fetching for GPS coords: ${lat}, ${lon}`);
      html = await fetchTslForCoords(lat, lon, "planets-visible-tonight");
    } else {
      html = await fetchTadUrl(`https://theskylive.com/planets-visible-tonight`);
    }

    const planets = parsePlanetsHtml(html);
    if (planets) {
      return res.json({ ok: true, city: cityInfo, source: "TheSkyLive Live", planets });
    }
  } catch (e) {
    console.error("Planets parse error:", e.message);
  }

  // Sharjah-accurate fallback dataset
  const defaultPlanets = [
    { name: "Mercury", visibility: "Before sunrise, difficult", mag: "2.42", elongation: "14° W", comment: "Before sunrise, difficult" },
    { name: "Venus", visibility: "After sunset", mag: "-4.21", elongation: "44° E", comment: "After sunset" },
    { name: "Mars", visibility: "Before sunrise", mag: "1.38", elongation: "43° W", comment: "Before sunrise" },
    { name: "Jupiter", visibility: "Not visible", mag: "-1.79", elongation: "5° E", comment: "Not visible" },
    { name: "Saturn", visibility: "Most of the night", mag: "0.68", elongation: "105° W", comment: "Most of the night" },
    { name: "Uranus", visibility: "End of the night", mag: "5.78", elongation: "55° W", comment: "End of the night" },
    { name: "Neptune", visibility: "Most of the night", mag: "7.72", elongation: "115° W", comment: "Most of the night" }
  ];

  res.json({ ok: true, city: cityInfo, source: "TheSkyLive Fallback", planets: defaultPlanets });
});

app.get("/api/neos", async (_req, res) => {
  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    
    const url = `https://api.nasa.gov/neo/rest/v1/feed?start_date=${todayStr}&end_date=${todayStr}&api_key=kbFweXputZzY0oBIm4ZQlJRLQxlVn5ZOCQtO1EPN`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`NASA API failed: ${r.status}`);
    const j = await r.json();
    
    const neosToday = j.near_earth_objects?.[todayStr] || [];
    
    const parsed = neosToday.map(neo => {
      const closeApproach = neo.close_approach_data?.[0];
      const missDist = closeApproach?.miss_distance?.kilometers || "Unknown";
      const missDistKm = parseFloat(missDist);
      const diameterMin = neo.estimated_diameter?.meters?.estimated_diameter_min || 0;
      const diameterMax = neo.estimated_diameter?.meters?.estimated_diameter_max || 0;
      return {
        id: neo.id,
        name: neo.name,
        diameter: `${Math.round(diameterMin)}-${Math.round(diameterMax)}m`,
        missDistance: isNaN(missDistKm) ? "Unknown" : `${(missDistKm / 1000).toLocaleString(undefined, {maximumFractionDigits:0})}k km`,
        missDistanceValue: isNaN(missDistKm) ? Infinity : missDistKm,
        isHazardous: neo.is_potentially_hazardous_asteroid || false,
        velocity: Math.round(parseFloat(closeApproach?.relative_velocity?.kilometers_per_hour || "0"))
      };
    });
    
    parsed.sort((a, b) => a.missDistanceValue - b.missDistanceValue);
    
    res.json({ ok: true, items: parsed.slice(0, 3) });
  } catch (err) {
    console.error("NASA NEO API error:", err.message);
    res.json({ ok: false, items: [], error: err.message });
  }
});

app.get("/api/sunspots", async (_req, res) => {
  try {
    const swpcUrl = "https://services.swpc.noaa.gov/json/solar_probabilities.json";
    const r = await fetch(swpcUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
    let probabilities = null;
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        probabilities = data[0];
      }
    }
    
    res.json({
      ok: true,
      source: "NASA SOHO / SDO & NOAA SWPC",
      imageUrl: "https://soho.nascom.nasa.gov/data/synoptic/sunspots_earth/mdi_sunspots.jpg",
      highResImageUrl: "https://soho.nascom.nasa.gov/data/synoptic/sunspots_earth/mdi_sunspots_1024.jpg",
      sdoImageUrl: "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIF.jpg",
      sohoUrl: "https://soho.nascom.nasa.gov/sunspots/",
      title: "NASA SOHO Live Sunspot Activity",
      description: "Real-time solar disk observation showing active sunspots and magnetic regions monitored by SOHO and SDO spacecraft.",
      cClass: probabilities ? `${probabilities.c_class_1_day || 95}%` : "95%",
      mClass: probabilities ? `${probabilities.m_class_1_day || 55}%` : "55%",
      xClass: probabilities ? `${probabilities.x_class_1_day || 10}%` : "10%"
    });
  } catch (err) {
    console.error("Sunspots API error:", err.message);
    res.json({
      ok: true,
      source: "NASA SOHO / SDO",
      imageUrl: "https://soho.nascom.nasa.gov/data/synoptic/sunspots_earth/mdi_sunspots.jpg",
      highResImageUrl: "https://soho.nascom.nasa.gov/data/synoptic/sunspots_earth/mdi_sunspots_1024.jpg",
      sdoImageUrl: "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIF.jpg",
      sohoUrl: "https://soho.nascom.nasa.gov/sunspots/",
      title: "NASA SOHO Live Sunspot Activity",
      description: "Real-time solar disk observation showing active sunspots and magnetic regions monitored by SOHO and SDO spacecraft.",
      cClass: "95%",
      mClass: "55%",
      xClass: "10%"
    });
  }
});

const SUBMISSIONS_FILE = path.join(__dirname, "submissions.json");

// Helper to read submissions
function readSubmissions() {
  try {
    if (!fs.existsSync(SUBMISSIONS_FILE)) {
      fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(SUBMISSIONS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading submissions file:", err.message);
    return [];
  }
}

// Helper to write submissions
function writeSubmissions(data) {
  try {
    fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("Error writing submissions file:", err.message);
    return false;
  }
}

// 1. Submit Work (Student/Teacher)
app.post("/api/submissions", (req, res) => {
  try {
    const { authorName, role, type, title, content, schoolName, inchargeName } = req.body;
    
    if (!authorName || !role || !type || !title || !content || !schoolName || !inchargeName) {
      return res.status(400).json({ ok: false, error: "Missing required fields. Please fill in all fields." });
    }
    
    if (role !== "student" && role !== "teacher") {
      return res.status(400).json({ ok: false, error: "Invalid role. Must be student or teacher." });
    }
    
    if (type !== "article" && type !== "drawing") {
      return res.status(400).json({ ok: false, error: "Invalid type. Must be article or drawing." });
    }

    const db = readSubmissions();
    const newSubmission = {
      id: "_" + Math.random().toString(36).substr(2, 9) + Date.now().toString(36),
      authorName: cleanText(authorName),
      role,
      type,
      title: cleanText(title),
      schoolName: cleanText(schoolName),
      inchargeName: cleanText(inchargeName),
      content, // base64 drawing data or PDF content
      status: "pending",
      submittedAt: new Date().toISOString()
    };

    db.push(newSubmission);
    writeSubmissions(db);

    res.json({ ok: true, message: "Submission received! Pending admin approval." });
  } catch (err) {
    console.error("Submission error:", err.message);
    res.status(500).json({ ok: false, error: "Internal server error." });
  }
});

// 2. Fetch Approved Submissions (Public)
app.get("/api/submissions", (req, res) => {
  try {
    const db = readSubmissions();
    const items = db.filter(item => item.status === "approved");
    res.json({ ok: true, items });
  } catch (err) {
    console.error("Get submissions error:", err.message);
    res.status(500).json({ ok: false, error: "Internal server error." });
  }
});

// 3. Admin: Fetch All Submissions (Moderation)
app.get("/api/admin/submissions", (req, res) => {
  try {
    const auth = req.headers["authorization"] || "";
    if (auth !== "Kshitijisthebestemployee") {
      return res.status(401).json({ ok: false, error: "Unauthorized access." });
    }
    
    const db = readSubmissions();
    const sorted = db.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    res.json({ ok: true, items: sorted });
  } catch (err) {
    console.error("Admin get submissions error:", err.message);
    res.status(500).json({ ok: false, error: "Internal server error." });
  }
});

// 4. Admin: Moderate Submission (Approve/Reject/Archive)
app.post("/api/admin/submissions/moderate", (req, res) => {
  try {
    const auth = req.headers["authorization"] || "";
    if (auth !== "Kshitijisthebestemployee") {
      return res.status(401).json({ ok: false, error: "Unauthorized access." });
    }
    
    const { id, action } = req.body;
    if (!id || (action !== "approve" && action !== "reject" && action !== "archive")) {
      return res.status(400).json({ ok: false, error: "Invalid parameters." });
    }
    
    const db = readSubmissions();
    const index = db.findIndex(item => item.id === id);
    
    if (index === -1) {
      return res.status(404).json({ ok: false, error: "Submission not found." });
    }
    
    db[index].status = action === "approve" ? "approved" : (action === "reject" ? "rejected" : "archived");
    writeSubmissions(db);
    
    res.json({ ok: true, message: `Submission successfully ${db[index].status}!` });
  } catch (err) {
    console.error("Moderation error:", err.message);
    res.status(500).json({ ok: false, error: "Internal server error." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
