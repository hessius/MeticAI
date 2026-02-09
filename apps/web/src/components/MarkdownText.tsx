import React from 'react'

interface MarkdownTextProps {
  children?: string
  text?: string
  className?: string
}

/**
 * Clean malformed markdown patterns that the LLM sometimes outputs:
 * - "** text" (space after opening **)
 * - "**" alone on a line
 * - "###" alone on a line  
 * - Leading/trailing ** on profile names
 */
export function cleanMalformedMarkdown(text: string): string {
  return text
    // Remove lines that are just ** or ### (with optional whitespace)
    .replace(/^\s*\*\*\s*$/gm, '')
    .replace(/^\s*###\s*$/gm, '')
    // Fix "** text" pattern at start of line -> just "text"
    .replace(/^\*\*\s+(?!\*)/gm, '')
    // Fix "text **" pattern at end of line -> just "text"
    .replace(/(?<!\*)\s+\*\*$/gm, '')
    // Clean up multiple blank lines that result from removals
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Clean a profile name by removing any stray markdown formatting
 */
export function cleanProfileName(name: string): string {
  return name
    // Remove leading/trailing ** or *
    .replace(/^\*+\s*/, '')
    .replace(/\s*\*+$/, '')
    // Remove any remaining ** pairs (malformed bold)
    .replace(/\*\*/g, '')
    .trim()
}

/**
 * Sanitize a URL to prevent XSS attacks.
 * Only allows safe protocols: http:, https:, and mailto:
 * Returns the sanitized URL or '#' if the URL is unsafe.
 */
export function sanitizeUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    return '#'
  }
  
  // Trim whitespace and decode URL-encoded characters to prevent bypass attempts
  const trimmedUrl = url.trim()
  
  // Check for allowed protocols (case-insensitive)
  const allowedProtocols = /^(https?|mailto):/i
  
  // Check for protocol-relative URLs (starting with //)
  const protocolRelative = /^\/\//
  
  // Check for relative URLs (starting with / or ./)
  const relativeUrl = /^(\/|\.\/)/
  
  // Allow relative URLs
  if (relativeUrl.test(trimmedUrl)) {
    return trimmedUrl
  }
  
  // Allow protocol-relative URLs (will use same protocol as page)
  if (protocolRelative.test(trimmedUrl)) {
    return trimmedUrl
  }
  
  // For absolute URLs, check if protocol is allowed
  if (trimmedUrl.includes(':')) {
    if (allowedProtocols.test(trimmedUrl)) {
      return trimmedUrl
    }
    // Dangerous protocol detected (javascript:, data:, vbscript:, etc.)
    return '#'
  }
  
  // If no protocol specified, treat as relative URL
  return trimmedUrl
}

export function MarkdownText({ children, text, className = '' }: MarkdownTextProps) {
  const content = cleanMalformedMarkdown(text ?? children ?? '')
  
  const renderMarkdown = (textContent: string): React.ReactNode[] => {
    const lines = textContent.split('\n')
    const result: React.ReactNode[] = []
    let inCodeBlock = false
    let codeBlockLines: string[] = []
    let codeBlockKey = 0
    
    lines.forEach((line, lineIndex) => {
      // Handle code block start/end
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          // End of code block
          result.push(
            <pre key={`codeblock-${codeBlockKey++}`} className="bg-muted/50 rounded-md p-2 my-2 text-xs font-mono overflow-x-auto">
              <code>{codeBlockLines.join('\n')}</code>
            </pre>
          )
          codeBlockLines = []
          inCodeBlock = false
        } else {
          // Start of code block
          inCodeBlock = true
        }
        return
      }
      
      if (inCodeBlock) {
        codeBlockLines.push(line)
        return
      }
      
      // Skip empty lines but add some spacing
      if (line.trim() === '') {
        result.push(<div key={`space-${lineIndex}`} className="h-2" />)
        return
      }
      
      // Handle horizontal rules
      if (line.trim() === '---' || line.trim() === '***') {
        result.push(<hr key={`hr-${lineIndex}`} className="my-3 border-border/50" />)
        return
      }
      
      // Handle headers
      if (line.startsWith('### ')) {
        result.push(
          <h4 key={`h3-${lineIndex}`} className="text-sm font-semibold mt-3 mb-1">
            {processInlineMarkdown(line.substring(4), lineIndex)}
          </h4>
        )
        return
      }
      
      if (line.startsWith('## ')) {
        result.push(
          <h3 key={`h2-${lineIndex}`} className="text-base font-bold mt-2 mb-1">
            {processInlineMarkdown(line.substring(3), lineIndex)}
          </h3>
        )
        return
      }
      
      if (line.startsWith('# ')) {
        result.push(
          <h2 key={`h1-${lineIndex}`} className="text-lg font-bold mt-2 mb-1">
            {processInlineMarkdown(line.substring(2), lineIndex)}
          </h2>
        )
        return
      }
      
      // Handle list items
      if (line.trimStart().startsWith('- ') || line.trimStart().startsWith('* ')) {
        const indent = line.length - line.trimStart().length
        const listContent = line.trimStart().substring(2)
        result.push(
          <div key={`li-${lineIndex}`} className="flex items-start gap-2" style={{ paddingLeft: `${indent * 8}px` }}>
            <span className="text-muted-foreground">•</span>
            <span>{processInlineMarkdown(listContent, lineIndex)}</span>
          </div>
        )
        return
      }
      
      // Handle numbered list items
      const numberedMatch = line.trimStart().match(/^(\d+)\.\s+(.*)$/)
      if (numberedMatch) {
        const indent = line.length - line.trimStart().length
        result.push(
          <div key={`oli-${lineIndex}`} className="flex items-start gap-2" style={{ paddingLeft: `${indent * 8}px` }}>
            <span className="text-muted-foreground min-w-[1.5em]">{numberedMatch[1]}.</span>
            <span>{processInlineMarkdown(numberedMatch[2], lineIndex)}</span>
          </div>
        )
        return
      }
      
      // Handle **Label:** Value pattern (common in LLM output)
      const labelMatch = line.match(/^\*\*([^*]+):\*\*\s*(.*)$/)
      if (labelMatch) {
        result.push(
          <p key={`label-${lineIndex}`} className="leading-relaxed">
            <strong className="font-semibold">{labelMatch[1]}:</strong>
            {labelMatch[2] && <span> {labelMatch[2]}</span>}
          </p>
        )
        return
      }
      
      // Regular paragraph
      result.push(
        <p key={`p-${lineIndex}`} className="leading-relaxed">
          {processInlineMarkdown(line, lineIndex)}
        </p>
      )
    })
    
    // Handle unclosed code block
    if (inCodeBlock && codeBlockLines.length > 0) {
      result.push(
        <pre key={`codeblock-${codeBlockKey}`} className="bg-muted/50 rounded-md p-2 my-2 text-xs font-mono overflow-x-auto">
          <code>{codeBlockLines.join('\n')}</code>
        </pre>
      )
    }
    
    return result
  }

  const processInlineMarkdown = (text: string, lineIndex: number): React.ReactNode[] => {
    const parts: React.ReactNode[] = []
    let key = 0

    // Combined regex for links, bold, italic, and code
    const inlineRegex = /(\[([^\]]+)\]\(([^)]+)\)|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
    let lastIndex = 0
    let match

    while ((match = inlineRegex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        parts.push(<span key={`t-${lineIndex}-${key++}`}>{text.substring(lastIndex, match.index)}</span>)
      }

      if (match[2] && match[3]) {
        // [link text](url) - sanitize URL to prevent XSS
        const sanitizedUrl = sanitizeUrl(match[3])
        parts.push(
          <a 
            key={`a-${lineIndex}-${key++}`} 
            href={sanitizedUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {match[2]}
          </a>
        )
      } else if (match[4]) {
        // ***bold italic***
        parts.push(
          <strong key={`bi-${lineIndex}-${key++}`} className="font-semibold italic">
            {match[4]}
          </strong>
        )
      } else if (match[5]) {
        // **bold**
        parts.push(
          <strong key={`b-${lineIndex}-${key++}`} className="font-semibold">
            {match[5]}
          </strong>
        )
      } else if (match[6]) {
        // *italic*
        parts.push(
          <em key={`i-${lineIndex}-${key++}`} className="italic">
            {match[6]}
          </em>
        )
      } else if (match[7]) {
        // `code`
        parts.push(
          <code key={`c-${lineIndex}-${key++}`} className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
            {match[7]}
          </code>
        )
      }

      lastIndex = match.index + match[0].length
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(<span key={`t-${lineIndex}-${key++}`}>{text.substring(lastIndex)}</span>)
    }

    // If no matches found, return original text
    return parts.length > 0 ? parts : [<span key={`t-${lineIndex}-0`}>{text}</span>]
  }

  return (
    <div className={`space-y-1 ${className}`}>
      {renderMarkdown(content)}
    </div>
  )
}
