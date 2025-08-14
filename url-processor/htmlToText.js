import * as cheerio from 'cheerio';

/**
 * Convert HTML to structured text chunks using cheerio
 * @param {string} html - The HTML content to process
 * @returns {Array} Array of text chunks with type and content
 */
export function htmlToText(html) {
  const $ = cheerio.load(html);
  
  // Remove script and style elements
  $('script, style').remove();
  
  const chunks = [];
  
  // Walk through the DOM tree in document order
  function walkNode(node) {
    const $node = $(node);
    
    // If this is a text node with content
    if (node.nodeType === 3) {
      const text = $node.text().trim();
      if (text) {
        // Find the closest parent element to determine type
        const parent = $node.parent();
        const tagName = parent[0] ? parent[0].tagName.toLowerCase() : '';
        
        let chunk;
        if (tagName.match(/^h[1-6]$/)) {
          const level = parseInt(tagName.charAt(1));
          chunk = {
            text: text,
            type: "h",
            level: level
          };
        } else if (tagName === 'p') {
          chunk = {
            text: text,
            type: "p"
          };
        } else {
          chunk = {
            text: text,
            type: "other"
          };
        }
        chunks.push(chunk);
      }
      return;
    }
    
    // If this is an element node
    if (node.nodeType === 1) {
      const tagName = node.tagName.toLowerCase();
      
      // For paragraph and heading elements, collect all text content in one chunk
      if (tagName === 'p' || tagName.match(/^h[1-6]$/)) {
        const fullText = $node.text().replace(/\s+/g, ' ').trim();
        if (fullText) {
          let chunk;
          if (tagName.match(/^h[1-6]$/)) {
            const level = parseInt(tagName.charAt(1));
            chunk = {
              text: fullText,
              type: "h",
              level: level
            };
          } else {
            chunk = {
              text: fullText,
              type: "p"
            };
          }
          chunks.push(chunk);
        }
        return; // Don't process children of p/h elements
      }
      
      // For other elements, process children
      $node.contents().each((_, child) => {
        walkNode(child);
      });
    }
  }
  
  // Start walking from body or root
  const root = $('body').length ? $('body') : $.root();
  root.contents().each((_, child) => {
    walkNode(child);
  });
  
  // Clean up chunks without merging
  const cleanedChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const cleanText = chunk.text.replace(/\s+/g, ' ').trim();
    
    if (cleanText) {
      cleanedChunks.push({
        ...chunk,
        text: cleanText
      });
    }
  }
  
  // If no chunks were found, fall back to getting all text as a single "other" chunk
  if (cleanedChunks.length === 0) {
    const allText = $('body').length ? $('body').text() : $.text();
    const cleanText = allText.replace(/\s+/g, ' ').trim();
    if (cleanText) {
      cleanedChunks.push({
        text: cleanText,
        type: "other"
      });
    }
  }
  
  return cleanedChunks;
}
