import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR ||  '/kokoro/data';
const URLS_FILE = path.join(DATA_DIR, 'urls.json');
const KOKORO_API_URL = process.env.KOKORO_API_URL || 'http://localhost:5173/api/v1';

// Initialize OpenAI client for Kokoro TTS
const openai = new OpenAI({
  baseURL: KOKORO_API_URL,
  apiKey: process.env.OPENAI_API_KEY || "no-key",
});

app.use(express.json());
app.use(express.static('public'));

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
    console.error('Error creating data directory:', error);
  }
}

// Generate hash for URL
function generateHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

// Load URLs from file
async function loadUrls() {
  try {
    const data = await fs.readFile(URLS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading URLs:', error);
    return [];
  }
}

// Save URLs to file
async function saveUrls(urls) {
  try {
    await fs.writeFile(URLS_FILE, JSON.stringify(urls, null, 2));
  } catch (error) {
    console.error('Error saving URLs:', error);
  }
}

// Convert HTML to text using cheerio
function htmlToText(html) {
  const $ = cheerio.load(html);
  
  // Remove script and style elements
  $('script, style').remove();
  
  // Get text content and clean it up
  let text = $.text();
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// Process URL and generate TTS
async function processUrl(url) {
  const hash = generateHash(url);
  const urlDir = path.join(DATA_DIR, hash);
  
  try {
    // Check if directory already exists
    await fs.access(urlDir);
    console.log(`URL already processed: ${url}`);
    return { success: true, message: 'URL already processed', hash };
  } catch {
    // Directory doesn't exist, proceed with processing
  }
  
  try {
    // Create directory
    await fs.mkdir(urlDir, { recursive: true });
    
    // 1. Store URL in info.json
    await fs.writeFile(
      path.join(urlDir, 'info.json'),
      JSON.stringify({ url, processedAt: new Date().toISOString() }, null, 2)
    );
    
    // 2. Fetch URL content
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });
    
    // 3. Store HTML content and headers in html.json
    await fs.writeFile(
      path.join(urlDir, 'html.json'),
      JSON.stringify({
        content: response.data,
        headers: response.headers,
        status: response.status
      }, null, 2)
    );
    
    // 4. Process with Mozilla Readability
    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    if (!article) {
      throw new Error('Failed to parse article with Readability');
    }
    
    await fs.writeFile(
      path.join(urlDir, 'content.json'),
      JSON.stringify(article, null, 2)
    );
    
    // 5. Convert HTML content to text
    const textContent = htmlToText(article.content);
    await fs.writeFile(
      path.join(urlDir, 'text.json'),
      JSON.stringify({ text: textContent }, null, 2)
    );
    
    // 6. Generate TTS audio
    console.log(`Generating TTS for: ${url}`);
    const mp3 = await openai.audio.speech.create({
      model: "model_q8f16",
      voice: "af_heart",
      input: textContent.substring(0, 4000) // Limit text length for TTS
    });
    
    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.writeFile(path.join(urlDir, 'text.mp3'), buffer);
    
    console.log(`Successfully processed: ${url}`);
    return { success: true, message: 'URL processed successfully', hash };
    
  } catch (error) {
    console.error(`Error processing URL ${url}:`, error);
    // Clean up partial directory on error
    try {
      await fs.rm(urlDir, { recursive: true, force: true });
    } catch {}
    return { success: false, message: error.message, hash };
  }
}

// API Routes

// Get all URLs
app.get('/api/urls', async (req, res) => {
  const urls = await loadUrls();
  res.json(urls);
});

// Add new URL
app.post('/api/urls', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  // Trim URL
  const trimmedUrl = url.trim();
  
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  const urls = await loadUrls();
  
  // Check if URL already exists
  if (urls.includes(trimmedUrl)) {
    return res.status(400).json({ error: 'URL already exists' });
  }
  
  urls.push(trimmedUrl);
  await saveUrls(urls);
  
  // Process URL in background
  processUrl(trimmedUrl).then(result => {
    console.log('Processing result:', result);
  });
  
  res.json({ success: true, url: trimmedUrl });
});

// Delete URL
app.delete('/api/urls/:index', async (req, res) => {
  const index = parseInt(req.params.index);
  const urls = await loadUrls();
  
  if (index < 0 || index >= urls.length) {
    return res.status(404).json({ error: 'URL not found' });
  }
  
  const removedUrl = urls.splice(index, 1)[0];
  await saveUrls(urls);
  
  // Optionally remove processed data
  const hash = generateHash(removedUrl);
  const urlDir = path.join(DATA_DIR, hash);
  try {
    await fs.rm(urlDir, { recursive: true, force: true });
  } catch (error) {
    console.error('Error removing processed data:', error);
  }
  
  res.json({ success: true, removedUrl });
});

// Process all URLs
app.post('/api/process-all', async (req, res) => {
  const urls = await loadUrls();
  
  if (urls.length === 0) {
    return res.json({ message: 'No URLs to process' });
  }
  
  // Process URLs sequentially to avoid overwhelming the system
  const results = [];
  for (const url of urls) {
    const result = await processUrl(url);
    results.push({ url, ...result });
  }
  
  res.json({ results });
});

// Get processed data for a URL
app.get('/api/processed/:hash', async (req, res) => {
  const { hash } = req.params;
  const urlDir = path.join(DATA_DIR, hash);
  
  try {
    const info = JSON.parse(await fs.readFile(path.join(urlDir, 'info.json'), 'utf8'));
    const text = JSON.parse(await fs.readFile(path.join(urlDir, 'text.json'), 'utf8'));
    
    // Check if audio file exists
    const audioExists = await fs.access(path.join(urlDir, 'text.mp3')).then(() => true).catch(() => false);
    
    res.json({
      info,
      text: text.text,
      audioAvailable: audioExists
    });
  } catch (error) {
    res.status(404).json({ error: 'Processed data not found' });
  }
});

// Serve audio file
app.get('/api/audio/:hash', async (req, res) => {
  const { hash } = req.params;
  const audioPath = path.join(DATA_DIR, hash, 'text.mp3');
  
  try {
    await fs.access(audioPath);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.sendFile(audioPath);
  } catch (error) {
    res.status(404).json({ error: 'Audio file not found' });
  }
});

// Initialize and start server
await ensureDataDir();

app.listen(PORT, () => {
  console.log(`URL Processor service running on port ${PORT}`);
  console.log(`Kokoro API URL: ${KOKORO_API_URL}`);
});
