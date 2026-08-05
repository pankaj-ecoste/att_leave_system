import { Component } from 'react'

// Fixes plan.md §4.5 #10 — "no error boundary — any crash shows a white screen". A
// crash anywhere in the tree now shows a real message and a way back, not a blank page.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error in UI:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50 p-6">
        <div className="max-w-md w-full bg-white/5 border border-red-500/30 rounded-2xl p-6 text-center">
          <p className="text-red-300 font-semibold text-lg mb-2">Something went wrong</p>
          <p className="text-white/50 text-sm mb-4 break-words">{this.state.error.message || String(this.state.error)}</p>
          <button
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}
