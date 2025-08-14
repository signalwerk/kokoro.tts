import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Test the concatenateAudioWithSilence function
// Note: This is a simplified version for testing without the full server context

async function concatenateAudioWithSilence(chunkFiles, outputPath, options = {}) {
  const { 
    silenceDuration = 0.2 // seconds
  } = options;
  if (chunkFiles.length === 0) {
    throw new Error('No audio chunks to concatenate');
  }
  
  if (chunkFiles.length === 1) {
    await fs.copyFile(chunkFiles[0], outputPath);
    return;
  }
  
  try {
    await execAsync('ffmpeg -version');
  } catch (error) {
    throw new Error('ffmpeg is required for audio concatenation but is not available. Please install ffmpeg.');
  }
  
  try {
    const tempDir = path.dirname(path.resolve(outputPath));
    const timestamp = Date.now();
    const fileListPath = path.join(tempDir, `filelist-${timestamp}.txt`);
    const silencePath = path.join(tempDir, `silence-${timestamp}.mp3`);
    
    // Generate silence with same characteristics as the audio files
    await execAsync(`ffmpeg -f lavfi -i anullsrc=channel_layout=mono:sample_rate=22050 -t ${silenceDuration} -y "${silencePath}"`);
    
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
          fileListContent.push(`file '${silencePath}'`);
        }
      } catch (error) {
        console.warn(`Skipping missing chunk file: ${absolutePath}`);
      }
    }
    
    if (fileListContent.length === 0) {
      throw new Error('No valid chunk files found');
    }
    
    await fs.writeFile(fileListPath, fileListContent.join('\n'));
    
    // Concatenate using ffmpeg with copy codec to preserve original encoding
    const absoluteOutputPath = path.resolve(outputPath);
    const ffmpegCommand = `ffmpeg -f concat -safe 0 -i "${fileListPath}" -c copy -y "${absoluteOutputPath}"`;
    await execAsync(ffmpegCommand);
    
    // Clean up temporary files
    try {
      await fs.unlink(fileListPath);
      await fs.unlink(silencePath);
    } catch (cleanupError) {
      console.warn('Failed to clean up temporary files:', cleanupError);
    }
    
    console.log(`Successfully concatenated ${chunkFiles.length} audio files with ${silenceDuration}s silence gaps`);
  } catch (error) {
    console.error('ffmpeg concatenation failed:', error);
    throw new Error(`Audio concatenation failed: ${error.message}`);
  }
}

describe('Audio Concatenation', () => {
  const testDir = './test-audio';
  
  beforeAll(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });
  });
  
  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up test directory:', error);
    }
  });
  
  test('should handle empty chunk files array', async () => {
    await expect(concatenateAudioWithSilence([], 'output.mp3')).rejects.toThrow('No audio chunks to concatenate');
  });
  
  test('should copy single file when only one chunk', async () => {
    const inputFile = path.join(testDir, 'single.mp3');
    const outputFile = path.join(testDir, 'output-single.mp3');
    
    // Create a dummy MP3 file (minimal valid MP3 header)
    const mp3Header = Buffer.from([
      0xFF, 0xFB, 0x90, 0x00, // MP3 frame header
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]);
    await fs.writeFile(inputFile, mp3Header);
    
    await concatenateAudioWithSilence([inputFile], outputFile);
    
    // Check that output file exists and has same content
    const inputContent = await fs.readFile(inputFile);
    const outputContent = await fs.readFile(outputFile);
    expect(outputContent).toEqual(inputContent);
  });
  
  test('should handle ffmpeg errors gracefully with multiple chunks', async () => {
    const chunk1 = path.join(testDir, 'chunk1.mp3');
    const chunk2 = path.join(testDir, 'chunk2.mp3');
    const outputFile = path.join(testDir, 'output-multi.mp3');
    
    // Create dummy MP3 files (invalid for ffmpeg)
    const mp3Header = Buffer.from([
      0xFF, 0xFB, 0x90, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]);
    await fs.writeFile(chunk1, mp3Header);
    await fs.writeFile(chunk2, mp3Header);
    
    // This should throw an error due to invalid MP3 files
    await expect(concatenateAudioWithSilence([chunk1, chunk2], outputFile))
      .rejects.toThrow('Audio concatenation failed');
  });
});
