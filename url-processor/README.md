# URL Processor & Text-to-Speech Service

A Node.js service that processes URLs and converts their content to speech using the Kokoro TTS API.

## Features

- **Web UI**: Simple interface to manage URLs
- **URL Processing**: Automatically extracts and processes web content
- **Content Extraction**: Uses Mozilla Readability for clean content extraction
- **Text-to-Speech**: Converts extracted text to MP3 audio using Kokoro TTS
- **Data Storage**: Stores processed data in organized JSON files

## How it works

1. Add URLs through the web interface
2. Service creates a unique hash for each URL
3. For each URL, creates a folder `/kokoro/data/${hash}/` containing:
   - `info.json` - URL and processing metadata
   - `html.json` - Original HTML content and headers
   - `content.json` - Cleaned content via Mozilla Readability
   - `text.json` - Plain text extracted from HTML
   - `text.mp3` - Generated audio file

## API Endpoints

- `GET /` - Web UI
- `GET /api/urls` - Get all URLs
- `POST /api/urls` - Add new URL
- `DELETE /api/urls/:index` - Delete URL
- `POST /api/process-all` - Process all URLs
- `GET /api/processed/:hash` - Get processed content
- `GET /api/audio/:hash` - Download audio file

## Usage

1. Start the service with Docker Compose:
   ```bash
   docker-compose up -d
   ```

2. Access the web UI at: http://localhost:3001

3. Add URLs and click "Process All URLs" to generate audio files

## Environment Variables

- `KOKORO_API_URL` - URL of the Kokoro TTS API (default: http://kokoro-web:3000/api/v1)
- `PORT` - Service port (default: 3000)

## Data Storage

All processed data is stored in `/kokoro/data/` with the following structure:
```
/kokoro/data/
├── urls.json (list of all URLs)
└── ${hash}/ (one folder per URL)
    ├── info.json
    ├── html.json
    ├── content.json
    ├── text.json
    └── text.mp3
```
