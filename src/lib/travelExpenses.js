// plan.md §48 — pure helpers for standalone travel expenses (toll / lunch / other). No browser or
// network code here, so every rule is unit-tested; the screens and hooks just call these.

export const EXPENSE_CATEGORIES = ['Toll', 'Lunch', 'Other']
export const MAX_EXPENSE_AMOUNT = 100000 // same ceiling the database enforces — catches a stray extra zero
export const MAX_DESCRIPTION_LENGTH = 100 // same limit the database enforces

// Returns an error message, or null when the form is good to save.
export function validateExpenseInput({ category, description, amount, hasPhoto }) {
  if (!EXPENSE_CATEGORIES.includes(category)) return 'Choose an expense type'
  // "Other" must say what it was for (plan.md §49); Toll and Lunch need no text.
  if (category === 'Other') {
    const text = String(description || '').trim()
    if (!text) return 'Write what this expense was for'
    if (text.length > MAX_DESCRIPTION_LENGTH) return `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`
  }
  const n = Number(amount)
  if (amount === '' || amount == null || !Number.isFinite(n) || n <= 0) return 'Enter a valid amount'
  if (n > MAX_EXPENSE_AMOUNT) return 'That amount looks too large — please check it'
  if (!hasPhoto) return 'A bill photo is required'
  return null
}

export function groupExpensesByDate(expenses) {
  const out = {}
  for (const x of expenses || []) (out[x.date] ||= []).push(x)
  return out
}

export function sumExpenses(expenses) {
  return (expenses || []).reduce((s, x) => s + (Number(x.amount) || 0), 0)
}

// Every date that has a visit OR a standalone expense, oldest first — a day with only a toll must
// still appear in lists and in the report, or its money would silently drop out of the file.
export function allJourneyDates(visits, expenses) {
  return [...new Set([...(visits || []).map(v => v.date), ...(expenses || []).map(x => x.date)])].sort()
}

// Money total for one day's visit expenses plus standalone expenses (what the report totals).
export function dayExpenseTotal(visits, expenses) {
  return (visits || []).reduce((s, v) => s + (v.expenseAmount || 0), 0) + sumExpenses(expenses)
}

// What to show for one expense: "Toll", or "Other – parking" when the person said what it was.
export function expenseLabel(expense) {
  const text = String(expense?.description || '').trim()
  return text ? `${expense.category} – ${text}` : expense?.category || ''
}
