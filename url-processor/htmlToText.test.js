import { htmlToText } from "./htmlToText.js";

describe("htmlToText", () => {
  test("should handle simple nested structure without duplication", () => {
    const html = "<div>hello <p>world <a>link</a> foo</p> bar</div>";
    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "hello",
        type: "other",
      },
      {
        text: "world link foo",
        type: "p",
      },
      {
        text: "bar",
        type: "other",
      },
    ]);
  });

  test("should handle heading elements with correct levels", () => {
    const html =
      "<div><h1>Main Title</h1><h2>Subtitle</h2><p>Content</p></div>";
    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Main Title",
        type: "h",
        level: 1,
      },
      {
        text: "Subtitle",
        type: "h",
        level: 2,
      },
      {
        text: "Content",
        type: "p",
      },
    ]);
  });

  test("should handle multiple paragraph elements", () => {
    const html = "<div><p>First paragraph</p><p>Second paragraph</p></div>";
    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "First paragraph",
        type: "p",
      },
      {
        text: "Second paragraph",
        type: "p",
      },
    ]);
  });

  test("should handle mixed content types", () => {
    const html = `
      <article>
        <h1>Article Title</h1>
        <div>Introduction text</div>
        <p>First paragraph with <strong>bold</strong> text</p>
        <h2>Section</h2>
        <p>Second paragraph</p>
        <span>Footer text</span>
      </article>
    `;

    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Article Title",
        type: "h",
        level: 1,
      },
      {
        text: "Introduction text",
        type: "other",
      },
      {
        text: "First paragraph with bold text",
        type: "p",
      },
      {
        text: "Section",
        type: "h",
        level: 2,
      },
      {
        text: "Second paragraph",
        type: "p",
      },
      {
        text: "Footer text",
        type: "other",
      },
    ]);
  });

  test("should remove script and style elements", () => {
    const html = `
      <div>
        <script>console.log('test');</script>
        <p>Visible content</p>
        <style>body { color: red; }</style>
        <span>More content</span>
      </div>
    `;

    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Visible content",
        type: "p",
      },
      {
        text: "More content",
        type: "other",
      },
    ]);
  });

  test("should handle empty or whitespace-only elements", () => {
    const html = "<div><p>   </p><div></div><span>Real content</span></div>";
    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Real content",
        type: "other",
      },
    ]);
  });

  test("should normalize whitespace", () => {
    const html = "<p>Text   with\n\n  multiple\t\tspaces</p>";
    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Text with multiple spaces",
        type: "p",
      },
    ]);
  });

  test("should handle deeply nested structures without duplication", () => {
    const html = `
      <div>
        Outer text
        <section>
          Section text
          <article>
            Article text
            <p>Paragraph in article</p>
            More article text
          </article>
          More section text
        </section>
        More outer text
        <ul>
          <li>First item</li>
          <li>Second item</li>
        </ul>
        <ol>
          <li>Numbered first</li>
          <li>Numbered second</li>
        </ol>
        Final text
      </div>
    `;

    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Outer text Section text Article text",
        type: "other",
      },
      {
        text: "Paragraph in article",
        type: "p",
      },
      {
        text: "More article text More section text More outer text\n• First item\n• Second item\n1. Numbered first\n2. Numbered second\nFinal text",
        type: "other",
      },
    ]);
  });

  test("should handle links and inline elements correctly", () => {
    const html =
      '<div>Before <a href="#">link text</a> after <em>emphasis</em> end</div>';
    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Before link text after emphasis end",
        type: "other",
      },
    ]);
  });

  test("should handle empty HTML", () => {
    const html = "";
    const result = htmlToText(html);

    expect(result).toEqual([]);
  });

  test("should handle HTML with only whitespace", () => {
    const html = "<div>   \n\t   </div>";
    const result = htmlToText(html);

    expect(result).toEqual([]);
  });

  test("should handle complex real-world example", () => {
    const html = `
      <article>
        <header>
          <h1>Breaking News</h1>
          <div class="meta">Published today</div>
        </header>
        <div class="content">
          <p>This is the first paragraph of the article.</p>
          <h2>Important Section</h2>
          <p>This paragraph follows the section heading.</p>
          <div class="quote">
            Important quote text
            <cite>- Famous Person</cite>
          </div>
          <p>Final paragraph of the article.</p>
        </div>
      </article>
    `;

    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Breaking News",
        type: "h",
        level: 1,
      },
      {
        text: "Published today",
        type: "other",
      },
      {
        text: "This is the first paragraph of the article.",
        type: "p",
      },
      {
        text: "Important Section",
        type: "h",
        level: 2,
      },
      {
        text: "This paragraph follows the section heading.",
        type: "p",
      },
      {
        text: "Important quote text - Famous Person",
        type: "other",
      },
      {
        text: "Final paragraph of the article.",
        type: "p",
      },
    ]);
  });

  test("should handle all heading levels", () => {
    const html = `
      <div>
        <h1>Level 1</h1>
        <h2>Level 2</h2>
        <h3>Level 3</h3>
        <h4>Level 4</h4>
        <h5>Level 5</h5>
        <h6>Level 6</h6>
      </div>
    `;

    const result = htmlToText(html);

    expect(result).toEqual([
      { text: "Level 1", type: "h", level: 1 },
      { text: "Level 2", type: "h", level: 2 },
      { text: "Level 3", type: "h", level: 3 },
      { text: "Level 4", type: "h", level: 4 },
      { text: "Level 5", type: "h", level: 5 },
      { text: "Level 6", type: "h", level: 6 },
    ]);
  });

  test("should handle ordered lists with numbering", () => {
    const html = `
      <div>
        Introduction text
        <ol>
          <li>First item</li>
          <li>Second item</li>
          <li>Third item</li>
        </ol>
        Conclusion text
      </div>
    `;

    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Introduction text\n1. First item\n2. Second item\n3. Third item\nConclusion text",
        type: "other",
      },
    ]);
  });

  test("should handle unordered lists with bullets", () => {
    const html = `
      <div>
        Introduction text
        <ul>
          <li>First item</li>
          <li>Second item</li>
          <li>Third item</li>
        </ul>
        Conclusion text
      </div>
    `;

    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Introduction text\n• First item\n• Second item\n• Third item\nConclusion text",
        type: "other",
      },
    ]);
  });

  test("should handle mixed lists and other content", () => {
    const html = `
      <div>
        <h1>Shopping Lists</h1>
        <p>Here are my lists:</p>
        
        <h2>Groceries</h2>
        <ul>
          <li>Apples</li>
          <li>Bread</li>
        </ul>
        
        <h2>Tasks</h2>
        <ol>
          <li>Buy groceries</li>
          <li>Clean house</li>
        </ol>
        
        All done!
      </div>
    `;

    const result = htmlToText(html);

    expect(result).toEqual([
      {
        text: "Shopping Lists",
        type: "h",
        level: 1,
      },
      {
        text: "Here are my lists:",
        type: "p",
      },
      {
        text: "Groceries",
        type: "h",
        level: 2,
      },
      {
        text: "• Apples\n• Bread",
        type: "other",
      },
      {
        text: "Tasks",
        type: "h",
        level: 2,
      },
      {
        text: "1. Buy groceries\n2. Clean house\nAll done!",
        type: "other",
      },
    ]);
  });

  test("should handle user-provided example exactly", () => {
    const html = "<div>hello <p>world <a>link</a> foo</p> bar</div>";
    const result = htmlToText(html);

    // Check that we get the expected structure
    expect(result).toHaveLength(3);

    // Check individual chunks
    expect(result[0]).toEqual({
      text: "hello",
      type: "other",
    });

    expect(result[1]).toEqual({
      text: "world link foo",
      type: "p",
    });

    expect(result[2]).toEqual({
      text: "bar",
      type: "other",
    });
  });
});
