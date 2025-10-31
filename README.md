# Kokoro TTS URL Processor

- Server: [Kokoro TTS Web UI](https://kokoro.tts.srv.signalwerk.ch)
- Server: [RSS Feed for Podcast](https://rss.tts.srv.signalwerk.ch)

A text-to-speech system that converts web content into audio. Add URLs through a web interface, and the system automatically extracts the content and generates MP3 audio files using the Kokoro TTS engine.

## What it does

- Extracts clean content from web pages using Mozilla Readability
- Converts the text to natural-sounding speech
- Generates organized audio files with proper silence gaps
- Provides a web UI to manage URLs and download audio
- Generates a podcast RSS feed with all processed content

## How to run

1. Set up environment variables (create a `.env` file):

```bash
KOKORO_API_KEY=your_api_key_here
KOKORO_API_URL=http://kokoro-web:3000/api/v1
```

2. Start the services:

```bash
docker-compose up -d
```

3. Access the web interface:

- URL Processor UI: http://localhost:8543
- Podcast RSS Feed: http://localhost:8543/rss
- Kokoro TTS API: http://localhost:8542

4. Add URLs and the system will automatically process them into audio files

## Podcast RSS Feed

The system generates a podcast RSS feed at `/rss` containing all processed URLs as episodes. Subscribe to this feed in your favorite podcast app to listen to the converted content.

## Data Storage

All processed content and audio files are stored in `DATA/kokoro/data/` with a unique hash for each URL.

---

For detailed documentation about the URL processor, see [url-processor/README.md](url-processor/README.md)
