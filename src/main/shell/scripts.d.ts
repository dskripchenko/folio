// The shell integration's scripts, bundled as text.
declare module '*.zsh' {
  const text: string
  export default text
}
declare module '*.bash' {
  const text: string
  export default text
}
declare module '*.ps1' {
  const text: string
  export default text
}
