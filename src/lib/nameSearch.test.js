import { describe, it, expect } from 'vitest'
import { filterByNameOrNumber } from './nameSearch'

const rows = [
  { name: 'ADITYA RAJAN CHAVAN', num: '1248' },
  { name: 'Aman Kumar', num: '1155' },
  { name: 'Anirudh Pratap Singh', num: '1183' },
  { name: 'No Number Person', num: null },
]
const find = q => filterByNameOrNumber(rows, q, r => r.name, r => r.num).map(r => r.name)

describe('filterByNameOrNumber', () => {
  it('empty or blank box keeps everyone', () => {
    expect(find('')).toHaveLength(4)
    expect(find('   ')).toHaveLength(4)
    expect(find(undefined)).toHaveLength(4)
  })
  it('matches part of a name, ignoring capitals', () => {
    expect(find('aman')).toEqual(['Aman Kumar'])
    expect(find('ADITYA')).toEqual(['ADITYA RAJAN CHAVAN'])
    expect(find('an')).toEqual(['ADITYA RAJAN CHAVAN', 'Aman Kumar', 'Anirudh Pratap Singh'])
  })
  it('matches the employee number', () => {
    expect(find('1183')).toEqual(['Anirudh Pratap Singh'])
    expect(find('11')).toEqual(['Aman Kumar', 'Anirudh Pratap Singh'])
  })
  it('several words must all match, in any order', () => {
    expect(find('pratap anirudh')).toEqual(['Anirudh Pratap Singh'])
    expect(find('aman singh')).toEqual([])
  })
  it('ignores extra spaces', () => expect(find('  aman   kumar ')).toEqual(['Aman Kumar']))
  it('a row with no employee number still searches by name', () => expect(find('number')).toEqual(['No Number Person']))
  it('no match returns an empty list', () => expect(find('zzz')).toEqual([]))
})
