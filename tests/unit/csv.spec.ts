import { describe, expect, it } from 'vitest'
import { guessDelimiter, parseCsv } from '../../src/renderer/csvView'

describe('CSV', () => {
  it('fields in quotes: the separator, line breaks and "" inside', () => {
    expect(parseCsv('a,b\n1,"x, y"\n2,"say ""hi""\nthere"\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', 'x, y'],
      ['2', 'say "hi"\nthere'],
    ])
    expect(parseCsv('a;b\n;2', ';')).toEqual([
      ['a', 'b'],
      ['', '2'],
    ])
  })

  it('the separator a file keeps, a TSV by its name', () => {
    expect(guessDelimiter('name;price\nTea;1,50\nCake;3,20\n')).toBe(';')
    expect(guessDelimiter('a,b,c\n1,2,3\n')).toBe(',')
    expect(guessDelimiter('a\tb\n1\t2\n')).toBe('\t')
    expect(guessDelimiter('a,b\n1,2', 'data.tsv')).toBe('\t')
    expect(guessDelimiter('"x;y",b\n"1;2",3\n')).toBe(',')
  })
})
