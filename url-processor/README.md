# URL Processor & Text-to-Speech Service

A Node.js service that processes URLs and HTML content, converting them to speech using the Kokoro TTS API.

## Features

- **Web UI**: Simple interface to manage URLs and HTML content
- **URL Processing**: Automatically fetches and processes web content
- **Direct HTML Input**: Paste HTML content directly for processing without fetching
- **Comments**: Add optional comments to organize your entries
- **Content Extraction**: Uses Mozilla Readability for clean content extraction
- **Text-to-Speech**: Converts extracted text to MP3 audio using Kokoro TTS
- **Audio Concatenation**: Professional audio concatenation with silence gaps using ffmpeg
- **Data Storage**: Stores processed data in organized JSON files
- **Audio Management**: Delete generated audio to allow reprocessing without removing URLs

## How it works

1. Add content through the web interface:
   - **URL Mode**: Enter a web URL - the service will fetch the content
   - **HTML Mode**: Paste HTML directly - skips the fetching step
   - **Comment** (optional): Add a note to help organize your entries
2. Service creates a unique hash for each entry (based on URL or HTML content)

3. For each entry, creates a folder `/kokoro/data/${hash}/` containing:
   - `info.json` - URL/identifier and processing metadata
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
- `GET /api/urls` - Get all URLs/HTML entries
- `POST /api/urls` - Add new URL (body: `{ url: string, comment?: string }`)
- `POST /api/html` - Add HTML content directly (body: `{ html: string, comment?: string }`)
- `DELETE /api/urls/:index` - Delete URL/HTML entry
- `DELETE /api/urls/:index/audio` - Delete generated audio for entry
- `POST /api/process-all` - Process all entries
- `GET /api/processed/:hash` - Get processed content
- `GET /api/status/:hash` - Get processing status for entry
- `GET /api/status-all` - Get status for all entries
- `GET /api/audio/:hash` - Download audio file

## Usage

1. Start the service with Docker Compose:

   ```bash
   docker-compose up -d
   ```

2. Access the web UI at: http://localhost:8543

3. Add content to process:
   - **URL Mode** (default): Enter a web URL to fetch and process
   - **HTML Mode**: Select HTML mode, paste HTML content directly
   - **Comment**: Optionally add a comment to help organize entries
4. Content will be processed automatically through all stages
5. Monitor progress through the web UI or status endpoints
6. Download or stream generated audio files

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
├── urls.json (list of all entries with metadata)
└── ${hash}/ (one folder per entry)
    ├── info.json
    ├── html.json
    ├── content.json
    ├── text.json
    ├── text.mp3 (final concatenated audio)
    └── chunks/ (individual chunk audio files)
        ├── ${chunk_hash}.mp3
        └── ...
```

### Entry Format in urls.json

Each entry in `urls.json` is an object containing:

- `url`: The URL or pseudo-URL identifier (e.g., `html://hash` for HTML entries)
- `addedAt`: ISO timestamp when entry was added
- `isHtml`: Boolean flag indicating if this is direct HTML input
- `comment`: Optional comment text for organizing entries

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
  paragraphSilence: 0.2, // seconds between paragraphs
  titleSilenceBefore: 0.5, // silence before titles
  titleSilenceAfter: 0.5, // silence after titles
});
```
