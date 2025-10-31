import express from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import dotenv from "dotenv";
import { exec } from "child_process";
import { promisify } from "util";
import { htmlToText, chunksToHtml } from "./htmlToText.js";

dotenv.config();

const TTS_TIMEOUT = 15 * 60 * 1000; // 15 minutes timeout

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || "/kokoro/data";
const URLS_FILE = path.join(DATA_DIR, "urls.json");
const KOKORO_API_URL =
  process.env.KOKORO_API_URL || "http://localhost:5173/api/v1";

// Clean up the API URL - remove trailing slash if present
const cleanKokoroUrl = KOKORO_API_URL.replace(/\/$/, "");

// Audio processing configuration
// paragraphSilence: default gap between paragraphs
// titleSilenceBefore/After: additional silence when transitioning
//   to and from title (heading) chunks
const AUDIO_CONFIG = {
  paragraphSilence: parseFloat(process.env.AUDIO_SILENCE_DURATION) || 0.2,
  titleSilenceBefore: parseFloat(process.env.AUDIO_TITLE_SILENCE_BEFORE) || 0.5,
  titleSilenceAfter: parseFloat(process.env.AUDIO_TITLE_SILENCE_AFTER) || 0.5,
};

// Initialize OpenAI client for Kokoro TTS
const openai = new OpenAI({
  baseURL: cleanKokoroUrl,
  apiKey: process.env.KOKORO_API_KEY || "no-key",
  timeout: TTS_TIMEOUT, // 5 minutes timeout
});

// Test the Kokoro API connection on startup
async function testKokoroConnection() {
  try {
    console.log(`Testing connection to Kokoro API at: ${cleanKokoroUrl}`);

    // Try a small test request
    const testMp3 = await openai.audio.speech.create({
      model: "model_q8f16",
      voice: "af_heart",
      input: "Connection test",
    });

    console.log("✓ Kokoro API connection successful");
  } catch (error) {
    console.error("✗ Kokoro API connection failed:", error.message);
    console.error(
      "Please check that the Kokoro TTS service is running and accessible",
    );

    // Try to provide more diagnostic information
    if (error.status) {
      console.error(`HTTP Status: ${error.status}`);
    }
    if (error.response?.data) {
      console.error("Response data:", error.response.data);
    }
  }
}

app.use(express.json());

// Basic auth middleware
function basicAuth(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="URL Processor"');
    return res.status(401).send("Authentication required");
  }

  const credentials = Buffer.from(auth.slice(6), "base64").toString("utf8");
  const [username, password] = credentials.split(":");

  // Use KOKORO_API_KEY as password, admin as username
  const expectedPassword = process.env.KOKORO_API_KEY || "no-key";

  if (username !== "admin" || password !== expectedPassword) {
    res.setHeader("WWW-Authenticate", 'Basic realm="URL Processor"');
    return res.status(401).send("Invalid credentials");
  }

  next();
}

// API Routes (defined before static middleware to avoid conflicts)

// Health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    // Test Kokoro API
    const testMp3 = await Promise.race([
      openai.audio.speech.create({
        model: "model_q8f16",
        voice: "af_heart",
        input: "Health check",
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Health check timeout")), 10000),
      ),
    ]);

    res.json({
      status: "healthy",
      kokoroApi: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      kokoroApi: "disconnected",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get all URLs
app.get("/api/urls", basicAuth, async (req, res) => {
  const urls = await loadUrls();
  res.json(urls);
});

// Add new URL
app.post("/api/urls", basicAuth, async (req, res) => {
  const { url, comment } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  // Trim URL
  const trimmedUrl = url.trim();

  if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  const urls = await loadUrls();

  // Check if URL already exists (handle both string and object formats)
  const urlExists = urls.some((item) => {
    const existingUrl = typeof item === "string" ? item : item.url;
    return existingUrl === trimmedUrl;
  });

  if (urlExists) {
    return res.status(400).json({ error: "URL already exists" });
  }

  // Add URL with timestamp and optional comment
  const urlEntry = {
    url: trimmedUrl,
    addedAt: new Date().toISOString(),
    isHtml: false,
  };

  if (comment && comment.trim()) {
    urlEntry.comment = comment.trim();
  }

  urls.push(urlEntry);
  await saveUrls(urls);

  // Process URL in background
  processUrl(trimmedUrl).then((result) => {
    console.log("Processing result:", result);
  });

  res.json({ success: true, url: trimmedUrl, addedAt: urlEntry.addedAt });
});

// Add HTML content directly
app.post("/api/html", basicAuth, async (req, res) => {
  const { html, comment } = req.body;

  if (!html || !html.trim()) {
    return res.status(400).json({ error: "HTML content is required" });
  }

  const trimmedHtml = html.trim();

  // Generate a unique identifier based on HTML content
  const hash = generateHash(trimmedHtml);
  const pseudoUrl = `html://${hash}`;

  const urls = await loadUrls();

  // Check if this HTML content already exists
  const urlExists = urls.some((item) => {
    const existingUrl = typeof item === "string" ? item : item.url;
    return existingUrl === pseudoUrl;
  });

  if (urlExists) {
    return res.status(400).json({ error: "This HTML content already exists" });
  }

  // Add HTML entry with timestamp and optional comment
  const urlEntry = {
    url: pseudoUrl,
    addedAt: new Date().toISOString(),
    isHtml: true,
  };

  if (comment && comment.trim()) {
    urlEntry.comment = comment.trim();
  }

  urls.push(urlEntry);
  await saveUrls(urls);

  // Process HTML directly in background
  processHtml(pseudoUrl, trimmedHtml).then((result) => {
    console.log("Processing result:", result);
  });

  res.json({ success: true, url: pseudoUrl, addedAt: urlEntry.addedAt });
});

// Delete URL
app.delete("/api/urls/:index", basicAuth, async (req, res) => {
  const index = parseInt(req.params.index);
  const urls = await loadUrls();

  if (index < 0 || index >= urls.length) {
    return res.status(404).json({ error: "URL not found" });
  }

  const removedUrlEntry = urls.splice(index, 1)[0];
  const removedUrl =
    typeof removedUrlEntry === "string" ? removedUrlEntry : removedUrlEntry.url;
  await saveUrls(urls);

  // Optionally remove processed data
  const hash = generateHash(removedUrl);
  const urlDir = path.join(DATA_DIR, hash);
  try {
    await fs.rm(urlDir, { recursive: true, force: true });
  } catch (error) {
    console.error("Error removing processed data:", error);
  }

  res.json({ success: true, removedUrl });
});

// Delete generated audio but keep URL
app.delete("/api/urls/:index/audio", basicAuth, async (req, res) => {
  const index = parseInt(req.params.index);
  const urls = await loadUrls();

  if (index < 0 || index >= urls.length) {
    return res.status(404).json({ error: "URL not found" });
  }

  const urlEntry = urls[index];
  const url = typeof urlEntry === "string" ? urlEntry : urlEntry.url;
  const hash = generateHash(url);
  const audioPath = path.join(DATA_DIR, hash, "text.mp3");

  try {
    await fs.rm(audioPath, { force: true });
    delete audioProgress[hash];
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting audio:", error);
    res.status(500).json({ error: "Failed to delete audio" });
  }
});

// Process all URLs
app.post("/api/process-all", basicAuth, async (req, res) => {
  const urls = await loadUrls();

  if (urls.length === 0) {
    return res.json({ message: "No URLs to process" });
  }

  // Process URLs sequentially to avoid overwhelming the system
  const results = [];
  for (const urlEntry of urls) {
    const url = typeof urlEntry === "string" ? urlEntry : urlEntry.url;
    const result = await processUrl(url);
    results.push({ url, ...result });
  }

  res.json({ results });
});

// Get processed data for a URL
app.get("/api/processed/:hash", basicAuth, async (req, res) => {
  const { hash } = req.params;
  const urlDir = path.join(DATA_DIR, hash);

  try {
    const info = JSON.parse(
      await fs.readFile(path.join(urlDir, "info.json"), "utf8"),
    );

    let htmlContent;
    let article;
    let textData;

    try {
      const htmlData = JSON.parse(
        await fs.readFile(path.join(urlDir, "html.json"), "utf8"),
      );
      htmlContent = htmlData.content;
    } catch {}

    try {
      article = JSON.parse(
        await fs.readFile(path.join(urlDir, "content.json"), "utf8"),
      );
    } catch {}

    try {
      textData = JSON.parse(
        await fs.readFile(path.join(urlDir, "text.json"), "utf8"),
      );
    } catch {}

    // Check if audio file exists
    const audioExists = await fs
      .access(path.join(urlDir, "text.mp3"))
      .then(() => true)
      .catch(() => false);

    res.json({
      info,
      html: htmlContent,
      article,
      textChunks: textData?.chunks || [],
      // Maintain backward compatibility
      textHTML: textData?.chunks
        ? chunksToHtml(textData.chunks)
        : textData?.text || "",
      audioAvailable: audioExists,
    });
  } catch (error) {
    res.status(404).json({ error: "Processed data not found" });
  }
});

// Get processing status for a URL
app.get("/api/status/:hash", basicAuth, async (req, res) => {
  const { hash } = req.params;
  const status = await getUrlStatus(hash);
  res.json(status);
});

// Get detailed progress for audio generation
app.get("/api/progress/:hash", basicAuth, async (req, res) => {
  const { hash } = req.params;

  if (audioProgress[hash]) {
    const progress = audioProgress[hash];
    const elapsed = Date.now() - progress.startTime;
    const avgTimePerChunk =
      progress.currentChunk > 0 ? elapsed / progress.currentChunk : 0;
    const estimatedTotal = avgTimePerChunk * progress.totalChunks;
    const estimatedRemaining = Math.max(0, estimatedTotal - elapsed);

    res.json({
      ...progress,
      elapsedMs: elapsed,
      estimatedRemainingMs: estimatedRemaining,
      avgTimePerChunkMs: avgTimePerChunk,
    });
  } else {
    res.json({ status: "not_generating" });
  }
});

// Get status for all URLs
app.get("/api/status-all", basicAuth, async (req, res) => {
  try {
    const urls = await loadUrls();
    const statuses = {};

    for (const urlEntry of urls) {
      const url = typeof urlEntry === "string" ? urlEntry : urlEntry.url;
      const hash = generateHash(url);
      statuses[url] = await getUrlStatus(hash);
    }

    res.json(statuses);
  } catch (error) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

// Serve audio file (NO AUTH REQUIRED)
app.get("/api/audio/:hash", async (req, res) => {
  const { hash } = req.params;
  const audioPath = path.join(DATA_DIR, hash, "text.mp3");
  const absoluteAudioPath = path.resolve(audioPath);

  try {
    await fs.access(absoluteAudioPath);
    res.setHeader("Content-Type", "audio/mpeg");
    res.sendFile(absoluteAudioPath);
  } catch (error) {
    console.error(`Audio file not found: ${absoluteAudioPath}`, error);
    res.status(404).json({ error: "Audio file not found" });
  }
});

// Generate RSS feed
app.get("/rss", basicAuth, async (req, res) => {
  try {
    const urls = await loadUrls();
    const completedUrls = [];

    for (const urlEntry of urls) {
      const url = typeof urlEntry === "string" ? urlEntry : urlEntry.url;
      const hash = generateHash(url);
      const status = await getUrlStatus(hash);

      if (status.status === "completed") {
        const urlDir = path.join(DATA_DIR, hash);
        try {
          const info = JSON.parse(
            await fs.readFile(path.join(urlDir, "info.json"), "utf8"),
          );
          const textData = JSON.parse(
            await fs.readFile(path.join(urlDir, "text.json"), "utf8"),
          );

          // Try to get the title from the first chunk if it's a heading
          let title = url;
          if (
            textData.chunks &&
            textData.chunks.length > 0 &&
            textData.chunks[0].type === "h"
          ) {
            title = textData.chunks[0].text;
          }

          completedUrls.push({
            url,
            hash,
            title,
            processedAt: info.processedAt,
            addedAt: typeof urlEntry === "object" ? urlEntry.addedAt : null,
            description: textData.chunks ? chunksToHtml(textData.chunks) : "",
          });
        } catch (error) {
          console.error("Error reading info for", url, error);
        }
      }
    }

    // Sort by processedAt date (newest first)
    completedUrls.sort(
      (a, b) => new Date(b.processedAt) - new Date(a.processedAt),
    );

    // Get the base URL for audio links
    const baseUrl = req.protocol + "://" + req.get("host");
    const coverImageUrl =
      "https://avatar.signalwerk.ch/latest/w2000/signalwerk.png";

    // Generate RSS XML
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Private Podcast Stream of Stefan Huber</title>
    <description>Text-to-speech audio content generated from web articles using Kokoro TTS</description>
    <link>${baseUrl}</link>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <itunes:image href="${coverImageUrl}"/>
    <itunes:category text="Technology"/>
    <itunes:subtitle>AI-generated audio from web content</itunes:subtitle>
    <itunes:summary>Automated text-to-speech conversion of web articles using Kokoro TTS technology</itunes:summary>
    <itunes:author>Kokoro TTS</itunes:author>
    <itunes:owner>
      <itunes:name>Kokoro TTS</itunes:name>
    </itunes:owner>
    <image>
      <url>${coverImageUrl}</url>
      <title>Private Podcast Stream of Stefan Huber</title>
      <link>${baseUrl}</link>
    </image>
${completedUrls
  .map(
    (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <description>${escapeXml(item.description)}</description>
      <link>${escapeXml(item.url)}</link>
      <guid isPermaLink="false">${item.hash}</guid>
      <pubDate>${new Date(item.processedAt).toUTCString()}</pubDate>
      <enclosure url="${baseUrl}/api/audio/${item.hash}" type="audio/mpeg"/>
      <itunes:image href="${coverImageUrl}"/>
      <itunes:duration>00:00:00</itunes:duration>
      <itunes:summary>${escapeXml(item.description)}</itunes:summary>
    </item>`,
  )
  .join("\n")}
  </channel>
</rss>`;

    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.send(rssXml);
  } catch (error) {
    console.error("Error generating RSS feed:", error);
    res.status(500).send("Error generating RSS feed");
  }
});

// Helper function to escape XML content
function escapeXml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Serve protected static files with basic auth (AFTER API routes)
app.use("/", basicAuth, express.static("public"));

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    // Initialize URLs file if it doesn't exist
    try {
      await fs.access(URLS_FILE);
    } catch {
      await fs.writeFile(URLS_FILE, JSON.stringify([]));
    }
  } catch (error) {
    console.error("Error creating data directory:", error);
  }
}

// Helper function to generate TTS with retries
async function generateTtsWithRetry(text, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`TTS attempt ${attempt}/${retries}...`);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `TTS request timeout after ${
                  TTS_TIMEOUT / 1000
                } seconds (attempt ${attempt})`,
              ),
            ),
          TTS_TIMEOUT,
        );
      });

      const ttsPromise = openai.audio.speech.create({
        model: "model_q8f16",
        voice: "af_heart",
        input: text,
      });

      const mp3 = await Promise.race([ttsPromise, timeoutPromise]);
      console.log(`TTS request successful on attempt ${attempt}`);

      return Buffer.from(await mp3.arrayBuffer());
    } catch (error) {
      console.error(`TTS attempt ${attempt} failed:`, error.message);

      if (attempt === retries) {
        throw error;
      }

      // Wait before retry (exponential backoff)
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`Retrying in ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// Generate hash for URL
function generateHash(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

// Load URLs from file
async function loadUrls() {
  try {
    const data = await fs.readFile(URLS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading URLs:", error);
    return [];
  }
}

// Save URLs to file
async function saveUrls(urls) {
  try {
    await fs.writeFile(URLS_FILE, JSON.stringify(urls, null, 2));
  } catch (error) {
    console.error("Error saving URLs:", error);
  }
}

// Step 1: Create directory and store URL info
async function storeUrlInfo(url, urlDir) {
  const infoPath = path.join(urlDir, "info.json");

  try {
    await fs.access(infoPath);
    console.log(`Info already exists for: ${url}`);
    return { success: true, skipped: true };
  } catch {
    // File doesn't exist, proceed with creation
  }

  try {
    await fs.mkdir(urlDir, { recursive: true });
    await fs.writeFile(
      infoPath,
      JSON.stringify({ url, processedAt: new Date().toISOString() }, null, 2),
    );
    console.log(`Stored info for: ${url}`);
    return { success: true, skipped: false };
  } catch (error) {
    console.error(`Error storing info for ${url}:`, error);
    return { success: false, error: error.message };
  }
}

// Step 2: Fetch URL content and store HTML
async function fetchAndStoreHtml(url, urlDir) {
  const htmlPath = path.join(urlDir, "html.json");

  try {
    await fs.access(htmlPath);
    console.log(`HTML already exists for: ${url}`);
    // Return the existing HTML content for use in next steps
    const htmlData = JSON.parse(await fs.readFile(htmlPath, "utf8"));
    return { success: true, skipped: true, htmlContent: htmlData.content };
  } catch {
    // File doesn't exist, proceed with fetching
  }

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 30000,
    });

    const htmlData = {
      content: response.data,
      headers: response.headers,
      status: response.status,
    };

    await fs.writeFile(htmlPath, JSON.stringify(htmlData, null, 2));
    console.log(`Fetched and stored HTML for: ${url}`);
    return { success: true, skipped: false, htmlContent: response.data };
  } catch (error) {
    console.error(`Error fetching HTML for ${url}:`, error);
    return { success: false, error: error.message };
  }
}

// Step 3: Process with Mozilla Readability
async function processWithReadability(url, urlDir, htmlContent) {
  const contentPath = path.join(urlDir, "content.json");

  try {
    await fs.access(contentPath);
    console.log(`Readability content already exists for: ${url}`);
    // Return the existing content for use in next steps
    const contentData = JSON.parse(await fs.readFile(contentPath, "utf8"));
    return { success: true, skipped: true, article: contentData };
  } catch {
    // File doesn't exist, proceed with processing
  }

  try {
    const dom = new JSDOM(htmlContent, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      throw new Error("Failed to parse article with Readability");
    }

    await fs.writeFile(contentPath, JSON.stringify(article, null, 2));
    console.log(`Processed with Readability for: ${url}`);
    return { success: true, skipped: false, article };
  } catch (error) {
    console.error(`Error processing with Readability for ${url}:`, error);
    return { success: false, error: error.message };
  }
}

// Step 4: Convert HTML content to text chunks
async function convertToText(url, urlDir, article) {
  const textPath = path.join(urlDir, "text.json");

  try {
    await fs.access(textPath);
    console.log(`Text content already exists for: ${url}`);
    // Return the existing text content for use in next steps
    const textData = JSON.parse(await fs.readFile(textPath, "utf8"));
    return { success: true, skipped: true, textChunks: textData.chunks };
  } catch {
    // File doesn't exist, proceed with conversion
  }

  try {
    const textChunks = htmlToText(article.content);

    // Add title as first chunk if it exists
    const finalChunks = [];
    if (article.title) {
      finalChunks.push({
        text: article.title,
        type: "h",
        level: 1,
      });
    }
    finalChunks.push(...textChunks);

    await fs.writeFile(
      textPath,
      JSON.stringify({ chunks: finalChunks }, null, 2),
    );
    console.log(
      `Converted to ${finalChunks.length} text chunks for: ${url} (including title)`,
    );
    return { success: true, skipped: false, textChunks: finalChunks };
  } catch (error) {
    console.error(`Error converting to text for ${url}:`, error);
    return { success: false, error: error.message };
  }
}

// Helper function to generate hash for text chunk
function generateTextHash(text) {
  return crypto.createHash("md5").update(text).digest("hex");
}

// Store for tracking audio generation progress
const audioProgress = {};

// Helper function to get processing status for a URL hash
async function getUrlStatus(hash) {
  const urlDir = path.join(DATA_DIR, hash);

  try {
    // Check which files exist to determine processing status
    const infoExists = await fs
      .access(path.join(urlDir, "info.json"))
      .then(() => true)
      .catch(() => false);
    const htmlExists = await fs
      .access(path.join(urlDir, "html.json"))
      .then(() => true)
      .catch(() => false);
    const contentExists = await fs
      .access(path.join(urlDir, "content.json"))
      .then(() => true)
      .catch(() => false);
    const textExists = await fs
      .access(path.join(urlDir, "text.json"))
      .then(() => true)
      .catch(() => false);
    const audioExists = await fs
      .access(path.join(urlDir, "text.mp3"))
      .then(() => true)
      .catch(() => false);

    let status = "not_started";
    let step = 0;
    let stepName = "Not started";
    let audioProgressInfo = null;

    if (infoExists) {
      status = "processing";
      step = 1;
      stepName = "URL info stored";
    }
    if (htmlExists) {
      step = 2;
      stepName = "HTML fetched";
    }
    if (contentExists) {
      step = 3;
      stepName = "Content processed";
    }
    if (textExists) {
      step = 4;
      stepName = "Text extracted";

      // Check if we're currently generating audio
      if (audioProgress[hash]) {
        step = 5;
        const progress = audioProgress[hash];
        if (progress.status === "generating") {
          stepName = `Generating audio (${progress.currentChunk}/${progress.totalChunks})`;
        } else if (progress.status === "concatenating") {
          stepName = "Concatenating audio files";
        }
        audioProgressInfo = progress;
      }
    }
    if (audioExists) {
      status = "completed";
      step = 5;
      stepName = "Audio generated";
    }

    const response = {
      status,
      step,
      stepName,
      totalSteps: 5,
      progress: Math.round((step / 5) * 100),
    };

    if (audioProgressInfo) {
      response.audioProgress = audioProgressInfo;
    }

    return response;
  } catch (error) {
    return {
      status: "not_started",
      step: 0,
      stepName: "Not started",
      totalSteps: 5,
      progress: 0,
    };
  }
}

// Step 5: Generate TTS audio
async function generateTtsAudio(url, urlDir, textChunks) {
  const audioPath = path.join(urlDir, "text.mp3");
  const chunksDir = path.join(urlDir, "chunks");
  const hash = generateHash(url);

  try {
    await fs.access(audioPath);
    console.log(`TTS audio already exists for: ${url}`);
    return { success: true, skipped: true };
  } catch {
    // File doesn't exist, proceed with generation
  }

  if (!textChunks || textChunks.length === 0) {
    console.log(`No text chunks to process for: ${url}`);
    return { success: true, skipped: true };
  }

  try {
    // Create chunks directory
    await fs.mkdir(chunksDir, { recursive: true });

    console.log(`Generating TTS for ${textChunks.length} chunks for: ${url}`);

    // Initialize progress tracking
    audioProgress[hash] = {
      currentChunk: 0,
      totalChunks: textChunks.length,
      status: "generating",
      startTime: Date.now(),
    };

    const chunkFiles = [];
    const chunkMeta = [];
    let successfulChunks = 0;
    let failedChunks = 0;

    // Process each chunk
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const chunkHash = generateTextHash(chunk.text);
      const chunkPath = path.join(chunksDir, `${chunkHash}.mp3`);

      // Update progress
      audioProgress[hash].currentChunk = i + 1;
      audioProgress[hash].successfulChunks = successfulChunks;
      audioProgress[hash].failedChunks = failedChunks;

      try {
        // Check if chunk audio already exists
        await fs.access(chunkPath);
        console.log(
          `Chunk ${i + 1}/${textChunks.length} already exists (${chunk.type}${
            chunk.level ? ` level ${chunk.level}` : ""
          })`,
        );
        successfulChunks++;
      } catch {
        // Generate TTS for this chunk
        console.log(
          `Processing chunk ${i + 1}/${textChunks.length} (${chunk.type}${
            chunk.level ? ` level ${chunk.level}` : ""
          }) - "${chunk.text.substring(0, 50)}${
            chunk.text.length > 50 ? "..." : ""
          }"`,
        );

        // Limit text length for TTS (Kokoro has limits)
        const limitedText = chunk.text.substring(0, 4000);

        console.log(`Making TTS request for chunk ${i + 1}...`);

        try {
          const buffer = await generateTtsWithRetry(limitedText);
          await fs.writeFile(chunkPath, buffer);

          console.log(`Successfully saved chunk ${i + 1}/${textChunks.length}`);
          successfulChunks++;
        } catch (chunkError) {
          console.error(
            `FAILED to generate TTS for chunk ${i + 1}/${textChunks.length}:`,
          );
          console.error(`  Error: ${chunkError.message}`);
          console.error(
            `  Chunk type: ${chunk.type}${
              chunk.level ? ` level ${chunk.level}` : ""
            }`,
          );
          console.error(
            `  Text preview: "${chunk.text.substring(0, 100)}${
              chunk.text.length > 100 ? "..." : ""
            }"`,
          );
          console.error(`  Text length: ${chunk.text.length} characters`);
          console.error(
            `  Limited text length: ${limitedText.length} characters`,
          );

          if (chunkError.status) {
            console.error(`  HTTP Status: ${chunkError.status}`);
          }
          if (chunkError.response?.data) {
            console.error(`  Response data:`, chunkError.response.data);
          }

          failedChunks++;

          // Skip this chunk entirely - don't add to chunkFiles
          continue;
        }
      }

      chunkFiles.push(chunkPath);
      chunkMeta.push(chunk);
    }

    console.log(
      `Completed TTS generation: ${successfulChunks} successful, ${failedChunks} failed chunks`,
    );

    if (failedChunks > 0) {
      console.warn(
        `WARNING: ${failedChunks} chunks failed to generate. Audio will be incomplete.`,
      );
    }

    if (successfulChunks === 0) {
      throw new Error(
        `All ${textChunks.length} chunks failed to generate TTS audio. Cannot create final audio file.`,
      );
    }

    // Update progress to concatenating
    audioProgress[hash].status = "concatenating";

    console.log(
      `Generated ${chunkFiles.length} audio chunks. Concatenating with silence gaps...`,
    );

    // Validate that all chunk files exist before concatenation
    const validChunkFiles = [];
    const validChunkMeta = [];
    for (let i = 0; i < chunkFiles.length; i++) {
      const chunkFile = chunkFiles[i];
      try {
        await fs.access(chunkFile);
        validChunkFiles.push(chunkFile);
        validChunkMeta.push(chunkMeta[i]);
      } catch (error) {
        console.warn(`Chunk file not found, skipping: ${chunkFile}`);
      }
    }

    if (validChunkFiles.length === 0) {
      throw new Error("No valid audio chunks found for concatenation");
    }

    console.log(
      `Concatenating ${validChunkFiles.length} valid audio chunks (${
        chunkFiles.length - validChunkFiles.length
      } chunks skipped due to generation failures)`,
    );

    // Create concatenated audio with configurable silence gaps
    await concatenateAudioWithSilence(
      validChunkFiles,
      audioPath,
      AUDIO_CONFIG,
      validChunkMeta,
    );

    // Complete and clean up progress tracking
    delete audioProgress[hash];

    console.log(`Generated final TTS audio for: ${url}`);
    return { success: true, skipped: false };
  } catch (error) {
    // Clean up progress tracking on error
    delete audioProgress[hash];
    console.error(`Error generating TTS for ${url}:`, error);
    return { success: false, error: error.message };
  }
}

// Function to concatenate audio files with silence gaps
async function concatenateAudioWithSilence(
  chunkFiles,
  outputPath,
  options = {},
  chunkMetadata = [],
) {
  const {
    paragraphSilence = 0.2,
    titleSilenceBefore = 0.5,
    titleSilenceAfter = 0.5,
  } = options;

  if (chunkFiles.length === 0) {
    throw new Error("No audio chunks to concatenate");
  }

  if (chunkFiles.length === 1) {
    // If only one chunk, just copy it
    await fs.copyFile(chunkFiles[0], outputPath);
    return;
  }

  try {
    // Check if ffmpeg is available
    await execAsync("ffmpeg -version");
  } catch (error) {
    throw new Error(
      "ffmpeg is required for audio concatenation but is not available. Please install ffmpeg.",
    );
  }

  try {
    // Create a temporary file list for ffmpeg
    const tempDir = path.dirname(path.resolve(outputPath));
    const timestamp = Date.now();
    const fileListPath = path.join(tempDir, `filelist-${timestamp}.txt`);

    // Cache for silence files keyed by duration
    const silenceFiles = new Map();
    async function getSilenceFile(duration) {
      const key = duration.toFixed(3);
      if (!silenceFiles.has(key)) {
        const silencePath = path.join(
          tempDir,
          `silence-${key}-${timestamp}.mp3`,
        );
        await execAsync(
          `ffmpeg -f lavfi -i anullsrc=channel_layout=mono:sample_rate=22050 -t ${duration} -y "${silencePath}"`,
        );
        silenceFiles.set(key, silencePath);
      }
      return silenceFiles.get(key);
    }

    // Create file list for ffmpeg concat - use absolute paths
    const fileListContent = [];
    for (let i = 0; i < chunkFiles.length; i++) {
      const absolutePath = path.resolve(chunkFiles[i]);

      // Verify file exists before adding to list
      try {
        await fs.access(absolutePath);
        fileListContent.push(`file '${absolutePath}'`);

        // Add silence between chunks (except after the last one)
        if (i < chunkFiles.length - 1) {
          let duration = paragraphSilence;
          const currentType = chunkMetadata[i]?.type;
          const nextType = chunkMetadata[i + 1]?.type;

          if (currentType === "h") duration = titleSilenceAfter;
          if (nextType === "h")
            duration = Math.max(duration, titleSilenceBefore);

          const silencePath = await getSilenceFile(duration);
          fileListContent.push(`file '${silencePath}'`);
        }
      } catch (error) {
        console.warn(`Skipping missing chunk file: ${absolutePath}`);
      }
    }

    if (fileListContent.length === 0) {
      throw new Error("No valid chunk files found");
    }

    await fs.writeFile(fileListPath, fileListContent.join("\n"));

    // Concatenate using ffmpeg and re-encode for broader compatibility
    const absoluteOutputPath = path.resolve(outputPath);
    const ffmpegCommand = `ffmpeg -f concat -safe 0 -i "${fileListPath}" -acodec libmp3lame -ar 22050 -ac 1 -y "${absoluteOutputPath}"`;
    await execAsync(ffmpegCommand);

    // Clean up temporary files
    try {
      await fs.unlink(fileListPath);
      for (const silencePath of silenceFiles.values()) {
        await fs.unlink(silencePath);
      }
    } catch (cleanupError) {
      console.warn("Failed to clean up temporary files:", cleanupError);
    }

    console.log(
      `Successfully concatenated ${chunkFiles.length} audio files with custom silence gaps`,
    );
  } catch (error) {
    console.error("ffmpeg concatenation failed:", error);
    throw new Error(`Audio concatenation failed: ${error.message}`);
  }
}

// Main process URL function that orchestrates all steps
async function processUrl(url) {
  const hash = generateHash(url);
  const urlDir = path.join(DATA_DIR, hash);

  try {
    // Step 1: Store URL info
    const infoResult = await storeUrlInfo(url, urlDir);
    if (!infoResult.success) {
      return {
        success: false,
        message: `Failed at step 1: ${infoResult.error}`,
        hash,
      };
    }

    // Step 2: Fetch and store HTML
    const htmlResult = await fetchAndStoreHtml(url, urlDir);
    if (!htmlResult.success) {
      return {
        success: false,
        message: `Failed at step 2: ${htmlResult.error}`,
        hash,
      };
    }

    // Step 3: Process with Readability
    const readabilityResult = await processWithReadability(
      url,
      urlDir,
      htmlResult.htmlContent,
    );
    if (!readabilityResult.success) {
      return {
        success: false,
        message: `Failed at step 3: ${readabilityResult.error}`,
        hash,
      };
    }

    // Step 4: Convert to text
    const textResult = await convertToText(
      url,
      urlDir,
      readabilityResult.article,
    );
    if (!textResult.success) {
      return {
        success: false,
        message: `Failed at step 4: ${textResult.error}`,
        hash,
      };
    }

    // Step 5: Generate TTS audio
    const ttsResult = await generateTtsAudio(
      url,
      urlDir,
      textResult.textChunks,
    );
    if (!ttsResult.success) {
      return {
        success: false,
        message: `Failed at step 5: ${ttsResult.error}`,
        hash,
      };
    }

    console.log(`Successfully processed: ${url}`);
    return {
      success: true,
      message: "URL processed successfully",
      hash,
      steps: {
        info: infoResult.skipped ? "skipped" : "processed",
        html: htmlResult.skipped ? "skipped" : "processed",
        readability: readabilityResult.skipped ? "skipped" : "processed",
        text: textResult.skipped ? "skipped" : "processed",
        tts: ttsResult.skipped ? "skipped" : "processed",
      },
    };
  } catch (error) {
    console.error(`Error processing URL ${url}:`, error);
    return { success: false, message: error.message, hash };
  }
}

// Process HTML content directly (without fetching from URL)
async function processHtml(pseudoUrl, htmlContent) {
  const hash = generateHash(pseudoUrl);
  const urlDir = path.join(DATA_DIR, hash);

  try {
    // Step 1: Store URL info
    await fs.mkdir(urlDir, { recursive: true });
    const infoPath = path.join(urlDir, "info.json");
    await fs.writeFile(
      infoPath,
      JSON.stringify(
        { url: pseudoUrl, processedAt: new Date().toISOString() },
        null,
        2,
      ),
    );

    // Step 2: Store HTML content directly
    const htmlPath = path.join(urlDir, "html.json");
    const htmlData = {
      content: htmlContent,
      headers: {},
      status: 200,
    };
    await fs.writeFile(htmlPath, JSON.stringify(htmlData, null, 2));

    // Step 3: Process with Readability
    const readabilityResult = await processWithReadability(
      pseudoUrl,
      urlDir,
      htmlContent,
    );
    if (!readabilityResult.success) {
      return {
        success: false,
        message: `Failed at step 3: ${readabilityResult.error}`,
        hash,
      };
    }

    // Step 4: Convert to text
    const textResult = await convertToText(
      pseudoUrl,
      urlDir,
      readabilityResult.article,
    );
    if (!textResult.success) {
      return {
        success: false,
        message: `Failed at step 4: ${textResult.error}`,
        hash,
      };
    }

    // Step 5: Generate TTS audio
    const ttsResult = await generateTtsAudio(
      pseudoUrl,
      urlDir,
      textResult.textChunks,
    );
    if (!ttsResult.success) {
      return {
        success: false,
        message: `Failed at step 5: ${ttsResult.error}`,
        hash,
      };
    }

    console.log(`Successfully processed HTML: ${pseudoUrl}`);
    return {
      success: true,
      message: "HTML processed successfully",
      hash,
    };
  } catch (error) {
    console.error(`Error processing HTML ${pseudoUrl}:`, error);
    return { success: false, message: error.message, hash };
  }
}

// Initialize and start server
await ensureDataDir();

app.listen(PORT, async () => {
  console.log(`URL Processor service running on port ${PORT}`);
  console.log(`Kokoro API URL: ${cleanKokoroUrl}`);

  // Test Kokoro connection after a brief delay
  setTimeout(testKokoroConnection, 2000);
});
