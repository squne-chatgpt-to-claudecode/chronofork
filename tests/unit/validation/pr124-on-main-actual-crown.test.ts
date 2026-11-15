// Validation-only: run real 1250+ annual simulation on main#123 + PR#124, without fabricated death or success.
import { expect, it } from 'vitest'
import {
  createExperimentalIntegratedWorld,
  createExperimentalIntegratedEvaluators,
  INTEGRATED_SEED,
} from '../../../src/scenario/experimental/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'

it('Session A+B: real P1 death resolves Eldia CROWN and country ruler with traceable legal events', () => {
  let world = createExperimentalIntegratedWorld()
  const evaluators = createExperimentalIntegratedEvaluators(world, [])
  const holderId = 'person-exp-01'
  const heirId = 'person-exp-02'
  const titleId = 'title-exp-crown-eldia'
  const countryId = 'country-eldia'

  for (let i = 0; i < 25; i++) {
    const previous = world.persons.find(p => p.personId === holderId)!
    const outcome = runYear(world, {seed: INTEGRATED_SEED, branchId: 'validation-A0', evaluators})
    expect(outcome.status, 'year=' + world.year + '; ' +
      (outcome.status === 'HALTED' ? JSON.stringify(outcome.halt) : '')).toBe('COMPLETED')
    if (outcome.status !== 'COMPLETED') return
    world = outcome.world
    const now = world.persons.find(p => p.personId === holderId)!
    if (!previous.alive || now.alive) continue

    // Witness is the actual seed-driven B-003 mortality transition (not a synthetic 1285 fixture).
    expect(now.deathYear).toBe(1268)
    expect(world.year).toBe(1269)
    expect(outcome.events.some(e => e.eventType === 'PERSON_DEATH' &&
      e.involvedRefs.some(r => r.kind === 'PERSON' && r.id === holderId))).toBe(true)
    const crown = world.titles.find(t => t.titleId === titleId)!
    const country = world.countries.find(c => c.countryId === countryId)!
    expect(crown.holder).toEqual({status:'HELD', personId:heirId})
    expect(country.rulerPersonId).toBe(heirId)
    expect(world.persons.find(p => p.personId === heirId)?.alive).toBe(true)

    const caseRecord = world.legal.cases.find(c => c.titleId === titleId && c.status === 'APPROVED')
    expect(caseRecord?.candidatePersonIds).toEqual([heirId])
    expect(caseRecord?.reasonCodes).toContain('CROWN_SUCCESSION')
    const titleEvent = outcome.events.find(e => e.eventType === 'LEGAL_TITLE_TRANSFER' &&
      e.stateChanges.some(c => c.path.includes(titleId)))
    const rulerEvent = outcome.events.find(e => e.eventType === 'COUNTRY_RULER_SET' &&
      e.involvedRefs.some(r => r.kind === 'COUNTRY' && r.id === countryId))
    expect(titleEvent, 'CROWN must have a real LEGAL_TITLE_TRANSFER event').toBeDefined()
    expect(rulerEvent, 'country ruler must have a real COUNTRY_RULER_SET event').toBeDefined()
    for (const event of [titleEvent!, rulerEvent!]) {
      expect(event.sourceTraceIds.some(id => {
        const trace = outcome.traces.find(t => t.traceId === id)
        return trace?.ruleId === 'A-TIT-07' && trace.status === 'ACCEPT' &&
          trace.eventIds.includes(event.eventId)
      }), event.eventId + ' must have reciprocal accepted A-TIT-07 trace').toBe(true)
    }

    // New person IDs from PR#123 must stay bounded in this real simulation.
    for (const p of world.persons.filter(p => p.personId.startsWith('person:b002:auto:')))
      expect(p.personId.length).toBe(81)
    return
  }
  throw new Error('NO_REAL_P1_DEATH_WITHIN_1250_TO_1274')
}, 120_000)
