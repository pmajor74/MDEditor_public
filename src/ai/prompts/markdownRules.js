/**
 * Azure Wiki Markdown Rules
 *
 * Azure DevOps Wiki-specific markdown syntax and conventions
 */

const MARKDOWN_RULES = `
## Azure DevOps Wiki Markdown Reference

### Table of Contents

CRITICAL: Always use underscores: \`[[_TOC_]]\`. NEVER use asterisks: \`[[*TOC*]]\` is WRONG.

Use \`[[_TOC_]]\` at the top of your article to generate an automatic table of contents:

\`\`\`markdown
[[_TOC_]]

# Main Title

## Section 1
Content here...

## Section 2
Content here...
\`\`\`

### Headings

Use proper heading hierarchy (never skip levels):
- # = Title (H1) - One per page
- ## = Major section (H2)
- ### = Subsection (H3)
- #### = Sub-subsection (H4)

### Character Escaping

Do NOT backslash-escape characters in normal markdown text. Azure DevOps Wiki does not require escaping periods, parentheses, hyphens, or other punctuation in headings or body text.

- WRONG: \`### 1\\. Planning \\(overview\\)\`
- RIGHT: \`### 1. Planning (overview)\`
- WRONG: \`business\\-first approach\`
- RIGHT: \`business-first approach\`

Only escape characters when they would otherwise trigger markdown formatting (e.g., \`\\*\` to show a literal asterisk outside code).

### Links

**Internal wiki links:**
\`\`\`markdown
[Link Text](/Page-Path)
[Link to section](/Page-Path#section-anchor)
[Relative link](./Subpage)
\`\`\`

**External links:**
\`\`\`markdown
[External Site](https://example.com)
\`\`\`

### Images and Attachments

**Wiki attachments:**
\`\`\`markdown
![Alt text](/.attachments/image.png)
![Alt text](/.attachments/image.png =300x200)  <!-- With size -->
\`\`\`

**External images:**
\`\`\`markdown
![Alt text](https://example.com/image.png)
\`\`\`

### Code Blocks

**Inline code:**
\`\`\`markdown
Use \`code\` for inline code
\`\`\`

**Fenced code blocks with syntax highlighting:**
\`\`\`markdown
\`\`\`javascript
function example() {
  return "Hello";
}
\`\`\`
\`\`\`

Supported languages: javascript, typescript, python, csharp, java, json, yaml, xml, sql, bash, powershell, and many more.

### Tables

**Standard markdown tables:**
\`\`\`markdown
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
\`\`\`

**Column alignment:**
\`\`\`markdown
| Left     | Center   | Right    |
|:---------|:--------:|---------:|
| Left     | Center   | Right    |
\`\`\`

### Lists

**Unordered lists:**
\`\`\`markdown
- Item 1
- Item 2
  - Nested item
  - Another nested
- Item 3
\`\`\`

**Ordered lists:**
\`\`\`markdown
1. First item
2. Second item
   1. Nested numbered
   2. Another nested
3. Third item
\`\`\`

**Task lists:**
\`\`\`markdown
- [ ] Unchecked task
- [x] Completed task
- [ ] Another task
\`\`\`

### Text Formatting

\`\`\`markdown
**Bold text**
*Italic text*
***Bold and italic***
~~Strikethrough~~
\`\`\`

### Blockquotes

\`\`\`markdown
> This is a blockquote
> It can span multiple lines
>
> > Nested blockquotes work too
\`\`\`

### Horizontal Rules

\`\`\`markdown
---
\`\`\`

### Special Azure Wiki Syntax

**Work item links:**
\`\`\`markdown
#123          <!-- Link to work item -->
AB#123        <!-- Link to work item in another project -->
\`\`\`

**Pull request links:**
\`\`\`markdown
!123          <!-- Link to pull request -->
\`\`\`

**Mentions:**
\`\`\`markdown
@<user@email.com>    <!-- Mention a user -->
\`\`\`

### Collapsible Sections (HTML)

\`\`\`markdown
<details>
<summary>Click to expand</summary>

Hidden content goes here.
Can include **markdown**.

</details>
\`\`\`

### Alerts/Callouts (using blockquotes)

\`\`\`markdown
> [!NOTE]
> This is a note callout

> [!WARNING]
> This is a warning callout

> [!IMPORTANT]
> This is an important callout

> [!TIP]
> This is a tip callout

> [!CAUTION]
> This is a caution callout
\`\`\`

### Best Practices

1. **One H1 per page** - Use H1 only for the page title
2. **Don't skip heading levels** - Go H1 -> H2 -> H3, not H1 -> H3
3. **Use semantic formatting** - Bold for emphasis, not for headings
4. **Keep tables simple** - Complex tables are hard to maintain
5. **Use relative links** - Easier to maintain when pages move
6. **Alt text for images** - Always provide descriptive alt text
7. **Test your links** - Broken links hurt user experience
`;

module.exports = { MARKDOWN_RULES };
