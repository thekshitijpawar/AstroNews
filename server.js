const express = require("express");
const cors = require("cors");
const { XMLParser } = require("fast-xml-parser");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.static(".")); // serves index.html + assets

const PORT = 8080;

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

app.get("/api/moon", async (_req, res) => {
  try {
    const html = await fetchWithCurl("https://theskylive.com/moon-today");
    
    // Parse phase name
    let phase = "";
    const phaseMatch = html.match(/Phase:&nbsp;<number>([^<]+)<\/number>/i) || html.match(/<meta property="og:title" content="Moon Phase Today: ([^"]+)"/i);
    if (phaseMatch) {
      phase = phaseMatch[1].trim();
    }
    
    // Parse illumination
    let illumination = "";
    const illumMatch = html.match(/Illuminated:&nbsp;<number>([^<]+)<\/number>/i);
    if (illumMatch) {
      illumination = illumMatch[1].trim();
    }
    
    // Parse image
    let imageUrl = "";
    const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
    if (imgMatch) {
      imageUrl = imgMatch[1].trim();
    }
    
    if (!phase) throw new Error("Could not parse moon phase from HTML");

    res.json({
      ok: true,
      phase,
      illumination,
      imageUrl,
      source: "TheSkyLive"
    });
  } catch (err) {
    console.error("TheSkyLive Moon parse error:", err.message);
    
    // Mathematical Fallback
    const now = new Date();
    const baseNewMoon = new Date("2000-01-06T18:14:00Z").getTime();
    const msPerDay = 24 * 60 * 60 * 1000;
    const synodicMonth = 29.530588853;
    const diffDays = (now.getTime() - baseNewMoon) / msPerDay;
    const phaseValue = (diffDays / synodicMonth) % 1.0;
    const age = phaseValue * synodicMonth;
    const calcIllum = Math.round((1 - Math.cos(2 * Math.PI * phaseValue)) / 2 * 100);
    
    let calcPhase = "";
    let fallbackImg = "https://static.theskylive.com/website/images/moon/500jpg/moon22.jpg";
    if (age < 1.845) { calcPhase = "New Moon"; fallbackImg = "https://static.theskylive.com/website/images/moon/500jpg/moon0.jpg"; }
    else if (age < 5.537) { calcPhase = "Waxing Crescent"; fallbackImg = "https://static.theskylive.com/website/images/moon/500jpg/moon5.jpg"; }
    else if (age < 9.228) { calcPhase = "First Quarter"; fallbackImg = "https://static.theskylive.com/website/images/moon/500jpg/moon7.jpg"; }
    else if (age < 12.92) { calcPhase = "Waxing Gibbous"; fallbackImg = "https://static.theskylive.com/website/images/moon/500jpg/moon11.jpg"; }
    else if (age < 16.61) { calcPhase = "Full Moon"; fallbackImg = "https://static.theskylive.com/website/images/moon/500jpg/moon15.jpg"; }
    else if (age < 20.30) { calcPhase = "Waning Gibbous"; fallbackImg = "https://static.theskylive.com/website/images/moon/500jpg/moon18.jpg"; }
    else if (age < 23.99) { calcPhase = "Third Quarter"; fallbackImg = "https://static.theskylive.com/website/images/moon/500jpg/moon22.jpg"; }
    else if (age < 27.68) { calcPhase = "Waning Crescent"; fallbackImg = "https://static.theskylive.com/website/images/moon/500jpg/moon26.jpg"; }
    else { calcPhase = "New Moon"; fallbackImg = "https://static.theskylive.com/website/images/moon/500jpg/moon0.jpg"; }

    res.json({
      ok: true,
      phase: calcPhase,
      illumination: `${calcIllum}%`,
      imageUrl: fallbackImg,
      stale: true,
      error: err.message
    });
  }
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