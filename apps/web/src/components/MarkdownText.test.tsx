import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownText, cleanProfileName, cleanMalformedMarkdown, sanitizeUrl } from './MarkdownText'

describe('MarkdownText utilities', () => {
  describe('cleanProfileName', () => {
    it('should clean leading ** from profile name', () => {
      expect(cleanProfileName('** Berry Blast Bloom')).toBe('Berry Blast Bloom')
    })

    it('should clean trailing ** from profile name', () => {
      expect(cleanProfileName('Berry Blast Bloom **')).toBe('Berry Blast Bloom')
    })

    it('should clean both leading and trailing **', () => {
      expect(cleanProfileName('** Berry Blast Bloom **')).toBe('Berry Blast Bloom')
    })

    it('should clean single * from profile name', () => {
      expect(cleanProfileName('* Berry Blast Bloom')).toBe('Berry Blast Bloom')
    })

    it('should handle normal profile names without markdown', () => {
      expect(cleanProfileName('Berry Blast Bloom')).toBe('Berry Blast Bloom')
    })

    it('should trim whitespace', () => {
      expect(cleanProfileName('  Berry Blast Bloom  ')).toBe('Berry Blast Bloom')
    })

    it('should remove inline ** pairs', () => {
      expect(cleanProfileName('Berry **Blast** Bloom')).toBe('Berry Blast Bloom')
    })

    it('should handle empty string', () => {
      expect(cleanProfileName('')).toBe('')
    })
  })

  describe('cleanMalformedMarkdown', () => {
    it('should remove lines that are just **', () => {
      const input = 'First line\n**\nSecond line'
      const result = cleanMalformedMarkdown(input)
      expect(result).toBe('First line\n\nSecond line')
    })

    it('should remove lines that are just ###', () => {
      const input = 'First line\n###\nSecond line'
      const result = cleanMalformedMarkdown(input)
      expect(result).toBe('First line\n\nSecond line')
    })

    it('should remove ** at start of line with space after', () => {
      const input = '** This should be cleaned'
      const result = cleanMalformedMarkdown(input)
      expect(result).toBe('This should be cleaned')
    })

    it('should remove trailing ** at end of line', () => {
      const input = 'This should be cleaned **'
      const result = cleanMalformedMarkdown(input)
      expect(result).toBe('This should be cleaned')
    })

    it('should handle complex malformed markdown', () => {
      const input = '** Profile description\n**\nMore text\n###'
      const result = cleanMalformedMarkdown(input)
      expect(result).toBe('Profile description\n\nMore text')
    })

    it('should preserve valid markdown', () => {
      const input = '**Bold text** and *italic*'
      const result = cleanMalformedMarkdown(input)
      expect(result).toBe('**Bold text** and *italic*')
    })

    it('should reduce multiple blank lines', () => {
      const input = 'First\n\n\n\nSecond'
      const result = cleanMalformedMarkdown(input)
      expect(result).toBe('First\n\nSecond')
    })
  })

  describe('sanitizeUrl', () => {
    it('should allow http URLs', () => {
      expect(sanitizeUrl('http://example.com')).toBe('http://example.com')
    })

    it('should allow https URLs', () => {
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com')
    })

    it('should allow mailto URLs', () => {
      expect(sanitizeUrl('mailto:test@example.com')).toBe('mailto:test@example.com')
    })

    it('should allow relative URLs starting with /', () => {
      expect(sanitizeUrl('/path/to/page')).toBe('/path/to/page')
    })

    it('should allow relative URLs starting with ./', () => {
      expect(sanitizeUrl('./relative/path')).toBe('./relative/path')
    })

    it('should allow protocol-relative URLs', () => {
      expect(sanitizeUrl('//example.com/path')).toBe('//example.com/path')
    })

    it('should block javascript: protocol (XSS attack)', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('#')
    })

    it('should block javascript: protocol with uppercase', () => {
      expect(sanitizeUrl('JavaScript:alert(1)')).toBe('#')
    })

    it('should block data: protocol', () => {
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('#')
    })

    it('should block vbscript: protocol', () => {
      expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('#')
    })

    it('should block file: protocol', () => {
      expect(sanitizeUrl('file:///etc/passwd')).toBe('#')
    })

    it('should handle empty string', () => {
      expect(sanitizeUrl('')).toBe('#')
    })

    it('should handle null/undefined input', () => {
      expect(sanitizeUrl(null as any)).toBe('#')
      expect(sanitizeUrl(undefined as any)).toBe('#')
    })

    it('should trim whitespace from URLs', () => {
      expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com')
    })

    it('should allow URLs without protocol (treated as relative)', () => {
      expect(sanitizeUrl('example.com')).toBe('example.com')
    })

    it('should be case-insensitive for protocol matching', () => {
      expect(sanitizeUrl('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM')
      expect(sanitizeUrl('HTTP://example.com')).toBe('HTTP://example.com')
      expect(sanitizeUrl('MAILTO:test@example.com')).toBe('MAILTO:test@example.com')
    })
  })
})

describe('MarkdownText component', () => {
  it('should render plain text', () => {
    render(<MarkdownText>Hello world</MarkdownText>)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('should clean malformed markdown before rendering', () => {
    render(<MarkdownText>** Malformed text **</MarkdownText>)
    expect(screen.getByText('Malformed text')).toBeInTheDocument()
  })

  it('should render bold text correctly', () => {
    render(<MarkdownText>This is **bold** text</MarkdownText>)
    const boldElement = screen.getByText('bold')
    expect(boldElement.tagName).toBe('STRONG')
  })

  it('should render italic text correctly', () => {
    render(<MarkdownText>This is *italic* text</MarkdownText>)
    const italicElement = screen.getByText('italic')
    expect(italicElement.tagName).toBe('EM')
  })

  it('should render list items', () => {
    render(<MarkdownText>{'- Item 1\n- Item 2'}</MarkdownText>)
    expect(screen.getByText('Item 1')).toBeInTheDocument()
    expect(screen.getByText('Item 2')).toBeInTheDocument()
  })

  it('should handle Label: Value pattern', () => {
    render(<MarkdownText>{'**Profile Created:** Berry Blast'}</MarkdownText>)
    expect(screen.getByText('Profile Created:')).toBeInTheDocument()
    expect(screen.getByText('Berry Blast')).toBeInTheDocument()
  })

  it('should render headers', () => {
    render(<MarkdownText>### My Header</MarkdownText>)
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('My Header')
  })

  it('should render safe links with https', () => {
    render(<MarkdownText>{'[Click here](https://example.com)'}</MarkdownText>)
    const link = screen.getByRole('link', { name: 'Click here' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('should render safe links with http', () => {
    render(<MarkdownText>{'[Link](http://example.com)'}</MarkdownText>)
    const link = screen.getByRole('link', { name: 'Link' })
    expect(link).toHaveAttribute('href', 'http://example.com')
  })

  it('should render mailto links', () => {
    render(<MarkdownText>{'[Email](mailto:test@example.com)'}</MarkdownText>)
    const link = screen.getByRole('link', { name: 'Email' })
    expect(link).toHaveAttribute('href', 'mailto:test@example.com')
  })

  it('should sanitize javascript: protocol (XSS protection)', () => {
    render(<MarkdownText>{'[Malicious](javascript:alert(1))'}</MarkdownText>)
    const link = screen.getByRole('link', { name: 'Malicious' })
    expect(link).toHaveAttribute('href', '#')
  })

  it('should sanitize data: protocol URLs', () => {
    render(<MarkdownText>{'[Data URL](data:text/html,<script>alert(1)</script>)'}</MarkdownText>)
    const link = screen.getByRole('link', { name: 'Data URL' })
    expect(link).toHaveAttribute('href', '#')
  })

  it('should sanitize vbscript: protocol URLs', () => {
    render(<MarkdownText>{'[VBScript](vbscript:msgbox(1))'}</MarkdownText>)
    const link = screen.getByRole('link', { name: 'VBScript' })
    expect(link).toHaveAttribute('href', '#')
  })

  it('should allow relative URLs', () => {
    render(<MarkdownText>{'[Relative](/path/to/page)'}</MarkdownText>)
    const link = screen.getByRole('link', { name: 'Relative' })
    expect(link).toHaveAttribute('href', '/path/to/page')
  })
})
