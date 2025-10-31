# Kokoro TTS URL Processor

A text-to-speech system that converts web content into audio. Add URLs or HTML content directly through a web interface, and the system automatically extracts the content and generates MP3 audio files using the Kokoro TTS engine.

## What it does

- Processes URLs by fetching and extracting web content
- Accepts direct HTML input for processing without fetching
- Extracts clean content from web pages using Mozilla Readability
- Converts the text to natural-sounding speech
- Generates organized audio files with proper silence gaps
- Provides a web UI to manage URLs/HTML and download audio
- Supports optional comments for each entry to help organize your content

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
   - Kokoro TTS API: http://localhost:8542

4. Add content to process:
   - **URL mode**: Enter a web URL to fetch and process
   - **HTML mode**: Paste HTML content directly for processing
   - **Optional**: Add a comment to help organize your entries

   The system will automatically process entries into audio files

## Data Storage

All processed content and audio files are stored in `DATA/kokoro/data/` with a unique hash for each URL.

---

For detailed documentation about the URL processor, see [url-processor/README.md](url-processor/README.md)
