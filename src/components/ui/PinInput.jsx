import { useState } from 'react'
import { Input } from './Input'

// A PIN box that shows dots by default, with an eye button to reveal what was typed
// (plan.md §44). Hidden again every time the screen is opened — it never starts revealed.
//
// `className` styles the input itself (e.g. text-center, tracking-widest);
// `wrapperClassName` is for spacing around the whole box (e.g. mb-3) — kept separate so the
// eye button stays vertically centred on the input instead of on the input plus its margin.
export function PinInput({ className = '', wrapperClassName = '', ...props }) {
  const [shown, setShown] = useState(false)
  // A centred PIN would sit off-centre with room for the eye only on the right, so a
  // centred box gets matching room on the left too.
  const padding = /text-center/.test(className) ? 'pl-11 pr-11' : 'pr-11'
  return (
    <div className={`relative ${wrapperClassName}`}>
      <Input
        type={shown ? 'text' : 'password'}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
        className={`${padding} ${className}`}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShown(s => !s)}
        aria-label={shown ? 'Hide PIN' : 'Show PIN'}
        aria-pressed={shown}
        title={shown ? 'Hide PIN' : 'Show PIN'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 text-white/40 hover:text-white/80 transition-colors"
      >
        {shown ? (
          // eye with a slash: PIN is visible, tap to hide
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          // plain eye: PIN is hidden, tap to show
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}
