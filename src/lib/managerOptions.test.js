import { describe, it, expect } from 'vitest'
import { managerChoices } from './managerOptions'

const emps = [
  { id: '1', name: 'Zed ', active: true, company: 'Asma Traexim Pvt Ltd', jobTitle: 'Driver' },
  { id: '2', name: 'Ankur Hora', active: true, company: 'Asma Traexim Pvt Ltd', jobTitle: 'Director' },
  { id: '3', name: 'Mukul Yadav', active: true, company: 'Metamask Design Solutions LLP', jobTitle: '' },
  { id: '4', name: 'Left Person', active: false, company: 'Asma Traexim Pvt Ltd' },
]

describe('managerChoices', () => {
  it('offers people from BOTH companies, A-Z', () => {
    expect(managerChoices(emps, 'x').map(c => c.name)).toEqual(['Ankur Hora', 'Mukul Yadav', 'Zed'])
  })
  it('leaves out the person being edited and inactive staff', () => {
    const ids = managerChoices(emps, '2').map(c => c.id)
    expect(ids).not.toContain('2')
    expect(ids).not.toContain('4')
  })
  it('labels with title and company', () => {
    expect(managerChoices(emps, 'x')[0].label).toBe('Ankur Hora (Director) · Asma')
    expect(managerChoices(emps, 'x')[1].label).toBe('Mukul Yadav · Metamask')
  })
  it('handles no employees', () => expect(managerChoices(null, 'x')).toEqual([]))
})
