/**
 * What a console's output says besides its text (ADR-007, 008): the shell
 * integration's marks — a command's text (633;E), its start (133;C), its end
 * with the exit code (133;D), a prompt (133;A) — and a program asking for
 * attention: OSC 9 with a message (iTerm2's, as Claude Code sends it), OSC 777
 * `notify` (rxvt's), or a lone BEL.
 */
export type ConsoleEvent =
  | { kind: 'command'; text: string }
  | { kind: 'start' }
  | { kind: 'end'; code: number | null }
  | { kind: 'prompt' }
  | { kind: 'notify'; text: string }
  | { kind: 'bell' }

// eslint-disable-next-line no-control-regex
const OSC = /\x1b\]([^\x07\x1b]*)(?:\x07|\x1b\\)/g

/** 633;E's escapes: `\x3b` for `;`, `\x0a` for a line break, `\\` for `\`. */
function unescape633(text: string): string {
  return text.replace(/\\x([0-9a-f]{2})|\\\\/gi, (m, hex: string | undefined) => (hex ? String.fromCharCode(parseInt(hex, 16)) : '\\'))
}

export function consoleEvents(data: string): ConsoleEvent[] {
  if (!data.includes('\x1b]') && !data.includes('\x07')) return []
  const out: ConsoleEvent[] = []
  let rest = ''
  let last = 0
  for (const m of data.matchAll(OSC)) {
    rest += data.slice(last, m.index)
    last = m.index! + m[0].length
    const body = m[1]!
    if (body.startsWith('633;E;')) out.push({ kind: 'command', text: unescape633(body.slice(6)) })
    else if (body === '133;C' || body.startsWith('133;C;')) out.push({ kind: 'start' })
    else if (body === '133;D' || body.startsWith('133;D;')) {
      const code = Number(body.slice(6))
      out.push({ kind: 'end', code: body.length > 6 && Number.isFinite(code) ? code : null })
    } else if (body === '133;A' || body.startsWith('133;A;')) out.push({ kind: 'prompt' })
    // OSC 9;4;… is a progress bar (ConEmu, Windows Terminal), not a message.
    else if (body.startsWith('9;') && !/^9;\d+;/.test(body)) out.push({ kind: 'notify', text: body.slice(2) })
    else if (body.startsWith('777;notify;')) out.push({ kind: 'notify', text: body.slice(11).split(';').filter(Boolean).join(': ') })
  }
  rest += data.slice(last)
  if (rest.includes('\x07')) out.push({ kind: 'bell' })
  return out
}
