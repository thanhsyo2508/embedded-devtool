/** Shared busy indicator — every panel used to reinvent its own "disable
 * the button + swap its text" busy state with no visual motion cue; this
 * is a small rotating ring meant to sit inline next to that same text
 * (doesn't replace the text swap, just adds a glanceable in-progress cue). */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`spinner ${className}`}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
