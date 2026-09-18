import { createPortal } from 'react-dom'

// Full-size image viewer with an explicit Back button (plan.md §28 admin feedback —
// thumbnails needed to be clickable to view the full selfie/receipt). Deliberately its
// own small overlay rather than reusing the generic <Modal>: that one caps width at
// max-w-3xl for forms, this wants the photo as large as the viewport allows.
export function PhotoViewerModal({ url, onClose }) {
  if (!url) return null
  return createPortal(
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" onClick={onClose}>
      <div className="p-4">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 text-white/80 hover:text-white text-sm font-medium bg-white/10 hover:bg-white/20 rounded-full px-4 py-2 transition-colors"
        >
          ← Back
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center p-4 min-h-0">
        <img src={url} alt="" className="max-w-full max-h-full object-contain rounded-lg" onClick={e => e.stopPropagation()} />
      </div>
    </div>,
    document.body
  )
}
