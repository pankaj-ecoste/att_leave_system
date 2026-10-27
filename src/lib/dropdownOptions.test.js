import { describe, it, expect } from 'vitest'
import { tidyOption, groupOptions, selectValues, matchOption, missingRequired, DROPDOWN_LISTS } from './dropdownOptions'

const opts = [{ id: '1', kind: 'job_title', value: 'Operator', inUse: 3 }, { id: '2', kind: 'job_title', value: 'Driver', inUse: 0 }]

describe('tidyOption', () => {
  it('trims and collapses spaces', () => expect(tidyOption('  Site   Engineer ')).toBe('Site Engineer'))
  it('handles null', () => expect(tidyOption(null)).toBe(''))
})

describe('groupOptions', () => {
  it('splits by kind and sorts A-Z ignoring case', () => {
    const g = groupOptions([
      { kind: 'department', value: 'sales' }, { kind: 'department', value: 'Admin' }, { kind: 'location', value: 'Ghitorni' },
    ])
    expect(g.department.map(o => o.value)).toEqual(['Admin', 'sales'])
    expect(g.location).toHaveLength(1)
    expect(g.job_title).toEqual([])
  })
  it('ignores an unknown kind and null input', () => {
    expect(groupOptions([{ kind: 'colour', value: 'x' }]).job_title).toEqual([])
    expect(groupOptions(null).business_unit).toEqual([])
  })
})

describe('selectValues', () => {
  it('lists the options as normal', () => {
    expect(selectValues(opts, 'Driver')).toEqual([{ value: 'Operator', notInList: false }, { value: 'Driver', notInList: false }])
  })
  it('keeps an old value that is not in the list, first, flagged', () => {
    const v = selectValues(opts, 'operator ')
    expect(v[0]).toEqual({ value: 'operator ', notInList: true })
    expect(v).toHaveLength(3)
  })
  it('adds nothing for a blank current value', () => {
    expect(selectValues(opts, '')).toHaveLength(2)
    expect(selectValues(opts, undefined)).toHaveLength(2)
  })
})

describe('matchOption', () => {
  it('matches ignoring case and spaces, returning the list spelling', () => expect(matchOption(opts, '  OPERATOR ')).toBe('Operator'))
  it('returns null for no match and for blank', () => {
    expect(matchOption(opts, 'Operater')).toBeNull()
    expect(matchOption(opts, '')).toBeNull()
    expect(matchOption([], 'Operator')).toBeNull()
  })
})

describe('missingRequired', () => {
  it('names every empty dropdown', () => expect(missingRequired({ jobTitle: 'Driver', dept: ' ', bu: '', locationInfo: undefined })).toEqual(['Department', 'Business Unit', 'Location']))
  it('is empty when all four are set', () => expect(missingRequired({ jobTitle: 'a', dept: 'b', bu: 'c', locationInfo: 'd' })).toEqual([]))
  it('covers exactly the four lists', () => expect(DROPDOWN_LISTS.map(l => l.kind)).toEqual(['job_title', 'department', 'business_unit', 'location']))
})
