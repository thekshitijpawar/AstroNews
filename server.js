const express = require("express");
const cors = require("cors");
const { XMLParser } = require("fast-xml-parser");

const app = express();
app.use(cors());
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
  { url: "https://phys.org/rss-feed/space-news/", source: "Phys.org Space News" },
  { url: "https://www.astronomy.com/feed/", source: "Astronomy.com" }
];

// Real upcoming launches
const LAUNCH_API = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=20";

// SeaSky source for celestial events (as requested)
const SEASKY_2026_URL = "https://www.seasky.org/astronomy/astronomy-calendar-2026.html";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true
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

function normalizeRssOrAtom(xml, sourceName) {
  const j = parser.parse(xml);
  const items = [];

  // RSS
  const rssItems = j?.rss?.channel?.item;
  if (rssItems) {
    for (const it of toArray(rssItems)) {
      const descriptionHtml = it.description || "";
      const mediaContent = it["media:content"]?.["@_url"] || "";
      const mediaThumb = it["media:thumbnail"]?.["@_url"] || "";
      const enclosure = it.enclosure?.["@_url"] || "";
      const imgFromDesc = extractImageFromHtml(descriptionHtml);

      items.push({
        title: cleanText(it.title || "Untitled"),
        url: it.link || "",
        publishedAt: it.pubDate || it.published || "",
        source: sourceName,
        summary: cleanText(descriptionHtml),
        imageUrl: mediaContent || mediaThumb || enclosure || imgFromDesc || ""
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

      const imgFromDesc = extractImageFromHtml(summaryRaw);

      items.push({
        title: cleanText(it.title?.["#text"] || it.title || "Untitled"),
        url: link,
        publishedAt: it.updated || it.published || "",
        source: sourceName,
        summary: cleanText(summaryRaw),
        imageUrl: imgFromDesc || ""
      });
    }
    return items;
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
        const xml = await fetchText(feed.url);
        const parsed = normalizeRssOrAtom(xml, feed.source);
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
      if (!dedup.has(key)) dedup.set(key, n);
    }

    const items = [...dedup.values()]
      .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
      .slice(0, 60);

    res.json({ ok: true, count: items.length, items, feedErrors });
  } catch (e) {
    console.error("News aggregate error:", e.message);
    res.json({ ok: false, count: 0, items: [], error: e.message });
  }
});

app.get("/api/launches", async (_req, res) => {
  try {
    const r = await fetchWithTimeout(LAUNCH_API);
    if (!r.ok) throw new Error(`Launch API failed: ${r.status}`);
    const j = await r.json();
    res.json({ ok: true, items: j.results || [] });
  } catch (e) {
    console.error("Launch API error:", e.message);
    res.json({ ok: false, items: [], error: e.message });
  }
});

app.get("/api/events", async (_req, res) => {
  try {
    const html = await fetchText(SEASKY_2026_URL);
    const allEvents = parseSeaSky2026(html);

    const now = new Date();
    const upcoming = allEvents
      .filter((e) => new Date(e.date) >= now)
      .slice(0, 30);

    res.json({
      ok: true,
      source: "SeaSky 2026",
      sourceUrl: SEASKY_2026_URL,
      count: upcoming.length,
      items: upcoming
    });
  } catch (e) {
    console.error("SeaSky events error:", e.message);
    res.json({ ok: false, count: 0, items: [], error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});