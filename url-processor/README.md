# URL Processor & Text-to-Speech Service

A Node.js service that processes URLs and converts their content to speech using the Kokoro TTS API.

## Features

- **Web UI**: Simple interface to manage URLs
- **URL Processing**: Automatically extracts and processes web content
- **Content Extraction**: Uses Mozilla Readability for clean content extraction
- **Text-to-Speech**: Converts extracted text to MP3 audio using Kokoro TTS
- **Audio Concatenation**: Professional audio concatenation with silence gaps using ffmpeg
- **Data Storage**: Stores processed data in organized JSON files
- **Audio Management**: Delete generated audio to allow reprocessing without removing URLs

## How it works

1. Add URLs through the web interface
2. Service creates a unique hash for each URL
3. For each URL, creates a folder `/kokoro/data/${hash}/` containing:
   - `info.json` - URL and processing metadata
   - `html.json` - Original HTML content and headers
   - `content.json` - Cleaned content via Mozilla Readability
   - `text.json` - Plain text extracted from HTML with chunk metadata
   - `chunks/` - Individual MP3 files for each text chunk
   - `text.mp3` - Final concatenated audio file with silence gaps

## Audio Processing

The service uses ffmpeg for professional audio concatenation:

### ffmpeg Concatenation
- Uses ffmpeg's concat demuxer to join chunks
- Re-encodes output for compatibility across players
- Adds configurable silence gaps with extra pauses around titles
- Requires ffmpeg to be installed in the environment

**Note**: ffmpeg is required for all audio concatenation operations. The service will fail gracefully with a clear error message if ffmpeg is not available.

## API Endpoints

- `GET /` - Web UI
- `GET /api/urls` - Get all URLs
- `POST /api/urls` - Add new URL
- `DELETE /api/urls/:index` - Delete URL
- `DELETE /api/urls/:index/audio` - Delete generated audio for URL
- `POST /api/process-all` - Process all URLs
- `GET /api/processed/:hash` - Get processed content
- `GET /api/status/:hash` - Get processing status for URL
- `GET /api/status-all` - Get status for all URLs
- `GET /api/audio/:hash` - Download audio file

## Usage

1. Start the service with Docker Compose:
   ```bash
   docker-compose up -d
   ```

2. Access the web UI at: http://localhost:8543

3. Add URLs and they will be processed automatically
4. Monitor progress through the status endpoints
5. Download generated audio files

## Environment Variables

- `KOKORO_API_URL` - URL of the Kokoro TTS API (default: http://kokoro-web:3000/api/v1)
- `KOKORO_API_KEY` - API key for Kokoro TTS
- `PORT` - Service port (default: 3000)
- `DATA_DIR` - Data storage directory (default: /kokoro/data)
- `AUDIO_SILENCE_DURATION` - Silence duration between paragraph chunks in seconds (default: 0.2)
- `AUDIO_TITLE_SILENCE_BEFORE` - Extra silence before title/heading chunks in seconds (default: 0.5)
- `AUDIO_TITLE_SILENCE_AFTER` - Extra silence after title/heading chunks in seconds (default: 0.5)

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
    ├── text.mp3 (final concatenated audio)
    └── chunks/ (individual chunk audio files)
        ├── ${chunk_hash}.mp3
        └── ...
```

## Development

### Running Tests
```bash
npm test
```

### Running in Development Mode
```bash
npm run dev
```

### Dependencies
- Node.js 18+
- ffmpeg (for audio processing)
- Express.js
- Mozilla Readability
- OpenAI SDK (for Kokoro TTS)

## Docker

The service includes ffmpeg in the Docker image for audio processing. The Dockerfile installs ffmpeg from Alpine packages for optimal performance and size.

## Audio Concatenation Options

The `concatenateAudioWithSilence` function supports the following options:

```javascript
await concatenateAudioWithSilence(chunkFiles, outputPath, {
  paragraphSilence: 0.2,      // seconds between paragraphs
  titleSilenceBefore: 0.5,    // silence before titles
  titleSilenceAfter: 0.5      // silence after titles
});
```
