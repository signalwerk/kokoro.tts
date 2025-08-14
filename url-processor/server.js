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
import { htmlToText } from './htmlToText.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR ||  '/kokoro/data';
const URLS_FILE = path.join(DATA_DIR, 'urls.json');
const KOKORO_API_URL = process.env.KOKORO_API_URL || 'http://localhost:5173/api/v1';

// Initialize OpenAI client for Kokoro TTS
const openai = new OpenAI({
  baseURL: KOKORO_API_URL,
  apiKey: process.env.KW_SECRET_API_KEY || "no-key",
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

// Step 1: Create directory and store URL info
async function storeUrlInfo(url, urlDir) {
  const infoPath = path.join(urlDir, 'info.json');
  
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
      JSON.stringify({ url, processedAt: new Date().toISOString() }, null, 2)
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
  const htmlPath = path.join(urlDir, 'html.json');
  
  try {
    await fs.access(htmlPath);
    console.log(`HTML already exists for: ${url}`);
    // Return the existing HTML content for use in next steps
    const htmlData = JSON.parse(await fs.readFile(htmlPath, 'utf8'));
    return { success: true, skipped: true, htmlContent: htmlData.content };
  } catch {
    // File doesn't exist, proceed with fetching
  }
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });
    
    const htmlData = {
      content: response.data,
      headers: response.headers,
      status: response.status
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
  const contentPath = path.join(urlDir, 'content.json');
  
  try {
    await fs.access(contentPath);
    console.log(`Readability content already exists for: ${url}`);
    // Return the existing content for use in next steps
    const contentData = JSON.parse(await fs.readFile(contentPath, 'utf8'));
    return { success: true, skipped: true, article: contentData };
  } catch {
    // File doesn't exist, proceed with processing
  }
  
  try {
    const dom = new JSDOM(htmlContent, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    if (!article) {
      throw new Error('Failed to parse article with Readability');
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
  const textPath = path.join(urlDir, 'text.json');
  
  try {
    await fs.access(textPath);
    console.log(`Text content already exists for: ${url}`);
    // Return the existing text content for use in next steps
    const textData = JSON.parse(await fs.readFile(textPath, 'utf8'));
    return { success: true, skipped: true, textChunks: textData.chunks };
  } catch {
    // File doesn't exist, proceed with conversion
  }
  
  try {
    const textChunks = htmlToText(article.content);
    await fs.writeFile(textPath, JSON.stringify({ chunks: textChunks }, null, 2));
    console.log(`Converted to ${textChunks.length} text chunks for: ${url}`);
    return { success: true, skipped: false, textChunks };
  } catch (error) {
    console.error(`Error converting to text for ${url}:`, error);
    return { success: false, error: error.message };
  }
}

// Helper function to generate hash for text chunk
function generateTextHash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

// Store for tracking audio generation progress
const audioProgress = {};

// Helper function to get processing status for a URL hash
async function getUrlStatus(hash) {
  const urlDir = path.join(DATA_DIR, hash);
  
  try {
    // Check which files exist to determine processing status
    const infoExists = await fs.access(path.join(urlDir, 'info.json')).then(() => true).catch(() => false);
    const htmlExists = await fs.access(path.join(urlDir, 'html.json')).then(() => true).catch(() => false);
    const contentExists = await fs.access(path.join(urlDir, 'content.json')).then(() => true).catch(() => false);
    const textExists = await fs.access(path.join(urlDir, 'text.json')).then(() => true).catch(() => false);
    const audioExists = await fs.access(path.join(urlDir, 'text.mp3')).then(() => true).catch(() => false);
    
    let status = 'not_started';
    let step = 0;
    let stepName = 'Not started';
    let audioProgressInfo = null;
    
    if (infoExists) {
      status = 'processing';
      step = 1;
      stepName = 'URL info stored';
    }
    if (htmlExists) {
      step = 2;
      stepName = 'HTML fetched';
    }
    if (contentExists) {
      step = 3;
      stepName = 'Content processed';
    }
    if (textExists) {
      step = 4;
      stepName = 'Text extracted';
      
      // Check if we're currently generating audio
      if (audioProgress[hash]) {
        step = 5;
        const progress = audioProgress[hash];
        if (progress.status === 'generating') {
          stepName = `Generating audio (${progress.currentChunk}/${progress.totalChunks})`;
        } else if (progress.status === 'concatenating') {
          stepName = 'Concatenating audio files';
        }
        audioProgressInfo = progress;
      }
    }
    if (audioExists) {
      status = 'completed';
      step = 5;
      stepName = 'Audio generated';
    }
    
    const response = {
      status,
      step,
      stepName,
      totalSteps: 5,
      progress: Math.round((step / 5) * 100)
    };
    
    if (audioProgressInfo) {
      response.audioProgress = audioProgressInfo;
    }
    
    return response;
  } catch (error) {
    return {
      status: 'not_started',
      step: 0,
      stepName: 'Not started',
      totalSteps: 5,
      progress: 0
    };
  }
}

// Step 5: Generate TTS audio
async function generateTtsAudio(url, urlDir, textChunks) {
  const audioPath = path.join(urlDir, 'text.mp3');
  const chunksDir = path.join(urlDir, 'chunks');
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
      status: 'generating'
    };
    
    const chunkFiles = [];
    
    // Process each chunk
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const chunkHash = generateTextHash(chunk.text);
      const chunkPath = path.join(chunksDir, `${chunkHash}.mp3`);
      
      // Update progress
      audioProgress[hash].currentChunk = i + 1;
      
      try {
        // Check if chunk audio already exists
        await fs.access(chunkPath);
        console.log(`Chunk ${i + 1}/${textChunks.length} already exists (${chunk.type}${chunk.level ? ` level ${chunk.level}` : ''})`);
      } catch {
        // Generate TTS for this chunk
        console.log(`Processing chunk ${i + 1}/${textChunks.length} (${chunk.type}${chunk.level ? ` level ${chunk.level}` : ''}) - "${chunk.text.substring(0, 50)}${chunk.text.length > 50 ? '...' : ''}"`);
        
        // Limit text length for TTS (Kokoro has limits)
        const limitedText = chunk.text.substring(0, 4000);
        
        const mp3 = await openai.audio.speech.create({
          model: "model_q8f16",
          voice: "af_heart",
          input: limitedText
        });
        
        const buffer = Buffer.from(await mp3.arrayBuffer());
        await fs.writeFile(chunkPath, buffer);
      }
      
      chunkFiles.push(chunkPath);
    }
    
    // Update progress to concatenating
    audioProgress[hash].status = 'concatenating';
    
    console.log(`Generated ${chunkFiles.length} audio chunks. Concatenating with silence gaps...`);
    
    // Create concatenated audio with 200ms silence gaps
    await concatenateAudioWithSilence(chunkFiles, audioPath);
    
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
async function concatenateAudioWithSilence(chunkFiles, outputPath) {
  if (chunkFiles.length === 0) {
    throw new Error('No audio chunks to concatenate');
  }
  
  if (chunkFiles.length === 1) {
    // If only one chunk, just copy it
    await fs.copyFile(chunkFiles[0], outputPath);
    return;
  }
  
  // For concatenation, we'll use a simple approach by reading all files
  // and creating a basic concatenated MP3
  // Note: This is a simplified approach. For production, you might want to use ffmpeg
  const buffers = [];
  
  for (let i = 0; i < chunkFiles.length; i++) {
    // Read the audio file
    const audioBuffer = await fs.readFile(chunkFiles[i]);
    buffers.push(audioBuffer);
    
    // Add silence gap (except for the last file)
    if (i < chunkFiles.length - 1) {
      // Create a simple 200ms silence buffer
      // This is a very basic approach - in production you'd want proper MP3 silence
      const silenceSize = Math.floor(audioBuffer.length * 0.05); // Rough approximation
      const silenceBuffer = Buffer.alloc(silenceSize, 0);
      buffers.push(silenceBuffer);
    }
  }
  
  // Concatenate all buffers
  const finalBuffer = Buffer.concat(buffers);
  await fs.writeFile(outputPath, finalBuffer);
}

// Main process URL function that orchestrates all steps
async function processUrl(url) {
  const hash = generateHash(url);
  const urlDir = path.join(DATA_DIR, hash);
  
  try {
    // Step 1: Store URL info
    const infoResult = await storeUrlInfo(url, urlDir);
    if (!infoResult.success) {
      return { success: false, message: `Failed at step 1: ${infoResult.error}`, hash };
    }
    
    // Step 2: Fetch and store HTML
    const htmlResult = await fetchAndStoreHtml(url, urlDir);
    if (!htmlResult.success) {
      return { success: false, message: `Failed at step 2: ${htmlResult.error}`, hash };
    }
    
    // Step 3: Process with Readability
    const readabilityResult = await processWithReadability(url, urlDir, htmlResult.htmlContent);
    if (!readabilityResult.success) {
      return { success: false, message: `Failed at step 3: ${readabilityResult.error}`, hash };
    }
    
    // Step 4: Convert to text
    const textResult = await convertToText(url, urlDir, readabilityResult.article);
    if (!textResult.success) {
      return { success: false, message: `Failed at step 4: ${textResult.error}`, hash };
    }
    
    // Step 5: Generate TTS audio
    const ttsResult = await generateTtsAudio(url, urlDir, textResult.textChunks);
    if (!ttsResult.success) {
      return { success: false, message: `Failed at step 5: ${ttsResult.error}`, hash };
    }
    
    console.log(`Successfully processed: ${url}`);
    return { 
      success: true, 
      message: 'URL processed successfully', 
      hash,
      steps: {
        info: infoResult.skipped ? 'skipped' : 'processed',
        html: htmlResult.skipped ? 'skipped' : 'processed',
        readability: readabilityResult.skipped ? 'skipped' : 'processed',
        text: textResult.skipped ? 'skipped' : 'processed',
        tts: ttsResult.skipped ? 'skipped' : 'processed'
      }
    };
    
  } catch (error) {
    console.error(`Error processing URL ${url}:`, error);
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
    const textData = JSON.parse(await fs.readFile(path.join(urlDir, 'text.json'), 'utf8'));
    
    // Check if audio file exists
    const audioExists = await fs.access(path.join(urlDir, 'text.mp3')).then(() => true).catch(() => false);
    
    res.json({
      info,
      textChunks: textData.chunks || [],
      // Maintain backward compatibility
      text: textData.chunks ? textData.chunks.map(chunk => chunk.text).join(' ') : textData.text || '',
      audioAvailable: audioExists
    });
  } catch (error) {
    res.status(404).json({ error: 'Processed data not found' });
  }
});

// Get processing status for a URL
app.get('/api/status/:hash', async (req, res) => {
  const { hash } = req.params;
  const status = await getUrlStatus(hash);
  res.json(status);
});

// Get status for all URLs
app.get('/api/status-all', async (req, res) => {
  try {
    const urls = await loadUrls();
    const statuses = {};
    
    for (const url of urls) {
      const hash = generateHash(url);
      statuses[url] = await getUrlStatus(hash);
    }
    
    res.json(statuses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get status' });
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
