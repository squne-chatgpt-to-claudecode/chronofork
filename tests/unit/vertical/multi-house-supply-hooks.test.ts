// Issue #114 担当B: 複数家門試遊構成のために追加した、既定で従来動作のopt-in技術フック3件の専用テスト。
//  1) supporting-marriage: candidateFilter（個別化前の絞り込みのみ。審査緩和・人口加算なし）
//  2) B-001: kinshipClearances / maxOpenCandidatesPerSeeker（証拠のある候補だけ記録し候補枯渇を避ける）
//  3) B-009: initialTrustSpread（同点のため相互最優先が永久に成立しない状況を避ける決定的な個体差）
// すべてCALIBRATION_ONLY。婚姻・出生の成否や相手は決めない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import {
  createB001SupportingMarriageEvaluator, createB009WorldStateEvaluator,
  EXPERIMENTAL_B009_CALIBRATION, validateB009Calibration,
} from '../../../src/simulation/rules/b/index.ts'
import {
  proposeSupportingMarriageCandidates, supportingCandidateId,
} from '../../../src/simulation/population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../../src/simulation/population/supporting-marriage.ts'
import type { SupportingKinshipClearance } from '../../../src/simulation/legal/supporting-kinship-clearance.ts'

const world = createExperimentalWorld()
const SEED = 4242
const cohort: SupportingMarriageCohort = {
  cohortId: 'hooks:east-female-1230', groupId: 'group-east-elite', affiliationHouseId: 'house-cardon',
  familyPoolId: 'hooks:family-pool', tier: 'REGIONAL_LOWER_NOBILITY', sex: 'FEMALE', birthYear: 1230,
  memberCount: 4, source: 'INITIAL_POPULATION', sourceEvidenceId: 'hooks:census', provenance: 'CALIBRATION_ONLY',
}
const supplyOptions = { seed: SEED, maxCandidates: 4, perCohortSamples: 4, maximumPreviewAge: 60 } as const
const id = (n: number) => supportingCandidateId(cohort.cohortId, n)

describe('supporting-marriage candidateFilter', () => {
  it('未指定は従来どおり。指定すると条件を満たす候補だけを返し、全て除外ならDEFER', () => {
    const all = proposeSupportingMarriageCandidates(world, 'person-exp-02', [cohort], supplyOptions)
    expect(all.candidates.map(c => c.candidateId).sort()).toEqual([0, 1, 2, 3].map(id).sort())
    const only = proposeSupportingMarriageCandidates(world, 'person-exp-02', [cohort], {
      ...supplyOptions, candidateFilter: c => c.candidateId === id(2) })
    expect(only.candidates.map(c => c.candidateId)).toEqual([id(2)])
    const none = proposeSupportingMarriageCandidates(world, 'person-exp-02', [cohort], {
      ...supplyOptions, candidateFilter: () => false })
    expect(none).toMatchObject({ status: 'DEFER', candidates: [], reasonCodes: ['NO_COHORT_CANDIDATE_AVAILABLE'] })
  })
  it('perCohortSamples=1でも除外された構成員は枠を消費せず、証拠のある構成員まで探索する', () => {
    for (const target of [0, 1, 2, 3]) {
      const r = proposeSupportingMarriageCandidates(world, 'person-exp-02', [cohort], {
        ...supplyOptions, perCohortSamples: 1, maxCandidates: 1, candidateFilter: c => c.candidateId === id(target) })
      expect(r.candidates.map(c => c.candidateId)).toEqual([id(target)])
    }
  })
})

describe('B-001 kinshipClearances（証拠付き候補だけを個別化）', () => {
  const clearance = (ordinal: number, personId = 'person-exp-02'): SupportingKinshipClearance => ({
    clearanceId: 'hooks:clearance:' + personId + ':' + ordinal,
    personIds: [personId, id(ordinal)].sort() as [string, string], countryId: 'country-eldia',
    checkedYear: 1250, validUntilYear: 1260, sourceEvidenceId: 'hooks:lineage:' + ordinal, provenance: 'CALIBRATION_ONLY',
  })
  const base = { cohorts: [cohort], maxRecordsPerYear: 4, maxAliveSupporting: 8, perCohortSamples: 4, maximumPreviewAge: 60 }
  const run = (extra: object) => {
    const e = createB001SupportingMarriageEvaluator({ ...base, ...extra } as never)
    if (!e.ok) throw new Error(e.issues.join(','))
    return runYear(world, { seed: SEED, branchId: 'hooks', evaluators: { 'B-001': e.evaluator } })
  }
  const recorded = (r: ReturnType<typeof run>) => (r as { world: typeof world }).world.persons
    .filter(p => p.interactionRole === 'SUPPORTING')

  it('未指定は従来どおり(証拠の有無に関係なく個別化する)', () => {
    expect(recorded(run({})).length).toBeGreaterThan(0)
  })
  it('指定時は当年有効なペア証拠のある候補だけを個別化し、証拠が無ければ何も記録せずDEFER Traceを残す', () => {
    const withEvidence = run({ kinshipClearances: [clearance(1)] })
    const ids = recorded(withEvidence).map(p => p.personId)
    expect(ids).toEqual([id(1)])
    const without = run({ kinshipClearances: [] }) as { world: typeof world; decisionTraces?: { status: string; reasonCodes: string[] }[] }
    expect(recorded(without as never)).toHaveLength(0)
    const expired = run({ kinshipClearances: [{ ...clearance(1), checkedYear: 1240, validUntilYear: 1250 }] })
    expect(recorded(expired)).toHaveLength(0)
  })
  it('証拠付き未婚候補が探索者あたりの上限に達していれば新たに個別化しない', () => {
    const existing = [0, 1].map(n => ({
      personId: id(n), name: 'hooks supporting ' + n, interactionRole: 'SUPPORTING' as const, sex: 'FEMALE' as const,
      birthYear: 1230, alive: true, originGroupId: cohort.groupId, houseId: cohort.affiliationHouseId,
      legalDynasty: { status: 'UNDETERMINED' as const, reasonCodes: ['POPULATION_COHORT_NOT_A_DYNASTY_PROOF'] },
    }))
    const preloaded = { ...world, persons: [...world.persons, ...existing] }
    const many = [0, 1, 2, 3].map(n => clearance(n))
    const go = (limit: number) => {
      const e = createB001SupportingMarriageEvaluator({ ...base, kinshipClearances: many, maxOpenCandidatesPerSeeker: limit })
      if (!e.ok) throw new Error(e.issues.join(','))
      const r = runYear(preloaded, { seed: SEED, branchId: 'hooks', evaluators: { 'B-001': e.evaluator } }) as { world: typeof world }
      return r.world.persons.filter(p => p.interactionRole === 'SUPPORTING').map(p => p.personId)
    }
    expect(go(2)).toEqual([id(0), id(1)]) // すでに2名: 追加しない
    const three = go(3)
    expect(three).toHaveLength(3) // 上限3なら1名だけ追加
    expect(new Set(three).size).toBe(3)
  })
  it('不正な上限値は評価器を作らない', () => {
    for (const bad of [0, 9, 1.5]) {
      expect(createB001SupportingMarriageEvaluator({ ...base, maxOpenCandidatesPerSeeker: bad } as never).ok).toBe(false)
    }
  })
})

describe('B-009 initialTrustSpread', () => {
  const trustOf = (calibration: object) => {
    const e = createB009WorldStateEvaluator([], { ...EXPERIMENTAL_B009_CALIBRATION, initialTrust: 20, ...calibration } as never)
    const r = runYear(world, { seed: SEED, branchId: 'b009', evaluators: { 'B-009': e } }) as { world: typeof world }
    return new Map((r.world.pairTrust ?? []).map(x => [JSON.stringify(x.personIds), x.value]))
  }
  it('既定(未指定/0)は従来動作で全新規ペアが同じ初期値', () => {
    const a = trustOf({}), b = trustOf({ initialTrustSpread: 0 })
    expect([...a]).toEqual([...b])
    expect(new Set(a.values()).size).toBe(1)
  })
  it('指定すると新規ペアの初期値は 初期値〜初期値+spread で決定的にばらつく(同入力で再現、seed非依存)', () => {
    const a = trustOf({ initialTrustSpread: 16 }), b = trustOf({ initialTrustSpread: 16 })
    expect([...a]).toEqual([...b])
    const plain = trustOf({})
    for (const [k, v] of a) {
      expect(v - plain.get(k)!).toBeGreaterThanOrEqual(0)
      expect(v - plain.get(k)!).toBeLessThanOrEqual(16)
    }
    expect(new Set(a.values()).size).toBeGreaterThan(3)
  })
  it('明示基礎値のあるペアにはspreadを加えない', () => {
    const pair = ['person-exp-01', 'person-exp-02'] as [string, string]
    const e = createB009WorldStateEvaluator([{ personIds: pair, value: 50 }], { ...EXPERIMENTAL_B009_CALIBRATION, initialTrust: 20, initialTrustSpread: 16 } as never)
    const r = runYear(world, { seed: SEED, branchId: 'b009', evaluators: { 'B-009': e } }) as { world: typeof world }
    expect(r.world.pairTrust?.find(x => JSON.stringify(x.personIds) === JSON.stringify(pair))?.value).toBe(51)
  })
  it('範囲外のspreadは検証で拒否する', () => {
    for (const bad of [-1, 41, 1.5]) {
      expect(validateB009Calibration({ ...EXPERIMENTAL_B009_CALIBRATION, initialTrustSpread: bad }).ok).toBe(false)
    }
    expect(validateB009Calibration({ ...EXPERIMENTAL_B009_CALIBRATION, initialTrust: 95, initialTrustSpread: 10 }).ok).toBe(false)
    expect(validateB009Calibration({ ...EXPERIMENTAL_B009_CALIBRATION, initialTrustSpread: 16 }).ok).toBe(true)
  })
})
