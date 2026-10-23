// plan.md §52 — every Save attempt carries a ticket so the server can tell "the same tap again" from
// "a new entry". The ticket belongs to one attempt, identified by a key (the photo that was taken):
//   - tapping Save again, or retrying after a weak-signal failure, uses the SAME key → the SAME ticket,
//     so the server hands back the first save instead of creating a second;
//   - a new photo / a cleared form is a different key → a fresh ticket.
// Pure (the id maker is passed in), so it is unit-tested.
export function makeTicketStore(newId) {
  let current = null // { key, id }
  return {
    get(key) {
      if (!current || current.key !== key) current = { key, id: newId() }
      return current.id
    },
    clear() { current = null },
  }
}
