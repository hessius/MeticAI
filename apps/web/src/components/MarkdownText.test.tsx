import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownText, cleanProfileName, cleanMalformedMarkdown } from './MarkdownText'

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
})
