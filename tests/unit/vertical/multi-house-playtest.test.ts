// Issue #114 担当B: 複数家門の試遊世界・世代更新（experimental, CALIBRATION_ONLY）の検証。
// 婚姻・出生・死亡・王朝所属・相続の成立は固定せず、実際の1250〜1350年の計算結果から不変条件(人口保存・出生枠・
// 候補重複・禁親/重婚審査・出典区別・決定性・A0/A1比較可能性)を検査し、観測値を console.info へ出す。
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createMultiHouseEvaluators, createMultiHouseWorld, createExperimentalWorld, createExperimentalOrdinaryLegalTrial,
  integratedRunConfigIdentity, multiHousePersonRecords, multiHouseRunConfigDigest, multiHouseRunConfigIdentity,
  MULTI_HOUSE_AUTONOMY, MULTI_HOUSE_B009_CALIBRATION, MULTI_HOUSE_CONFIG_ID, MULTI_HOUSE_EXTRA_SEEDS,
  MULTI_HOUSE_GOAL, MULTI_HOUSE_NEXTGEN_CONTRACT, MULTI_HOUSE_RUN_CONDITIONS, MULTI_HOUSE_SEED,
  MULTI_HOUSE_SUPPORTING_CLEARANCES, MULTI_HOUSE_SUPPORTING_COHORTS, MULTI_HOUSE_SUPPORTING_LIMITS,
  MULTI_HOUSE_TRUST_BASE, NALVEN_DYNASTY_ID,
} from '../../../src/scenario/experimental/index.ts'
import type { StatModifier, WorldState } from '../../../src/simulation/contracts/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import { reviewDomesticMarriageEligibility } from '../../../src/simulation/legal/nextgen-marriage.ts'
import { supportingCandidateId } from '../../../src/simulation/population/supporting-marriage.ts'

type Run = ReturnType<typeof runTimeline>
const LONG = 240_000
/** 観測値の出力。MULTI_HOUSE_OBS_OUT を指定するとJSON行としてファイルへも追記する(PR報告用)。 */
function report(label: string, value: unknown) {
  const line = label + ' ' + JSON.stringify(value)
  console.info(line)
  if (process.env['MULTI_HOUSE_OBS_OUT']) appendFileSync(process.env['MULTI_HOUSE_OBS_OUT'], line + '\n')
}
const pairOf = (ids: readonly string[]) => JSON.stringify([...ids].sort())

function run(seed: number, ledger: readonly StatModifier[] = [], branchId = 'multi-house') {
  const world = createMultiHouseWorld()
  const t0 = Date.now()
  const result = runTimeline(world, {
    seed, branchId, evaluators: createMultiHouseEvaluators(world, ledger),
    goal: MULTI_HOUSE_GOAL, technicalGoalEvaluation: true,
  })
  return { result, ms: Date.now() - t0 }
}
const cache = new Map<string, { result: Run; ms: number }>()
const cached = (seed: number) => {
  const k = String(seed)
  if (!cache.has(k)) cache.set(k, run(seed))
  return cache.get(k)!
}

function observe(seed: number, result: Run, ms: number) {
  const final = result.snapshots.at(-1)!
  const recs = multiHousePersonRecords(final)
  const byId = new Map(recs.map(r => [r.personId, r]))
  const depth = new Map<string, number>()
  const gen = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!
    const r = byId.get(id)
    const parents = [r?.fatherId, r?.motherId].filter((x): x is string => !!x)
    const g = parents.length ? 1 + Math.max(...parents.map(gen)) : 0
    depth.set(id, g)
    return g
  }
  const houses: Record<string, { people: number; maxGen: number; aliveAtEnd: number }> = {}
  for (const r of recs) {
    const h = (houses[r.houseId] ??= { people: 0, maxGen: 0, aliveAtEnd: 0 })
    h.people++; h.maxGen = Math.max(h.maxGen, gen(r.personId)); if (r.alive) h.aliveAtEnd++
  }
  const count = (t: string) => result.eventLog.filter(e => e.eventType === t).length
  const reasons: Record<string, number> = {}
  for (const t of result.decisionTraces) {
    if (!['B-001', 'B-002', 'B-005', 'A-LEG-01'].includes(t.ruleId)) continue
    const k = `${t.ruleId}:${t.status}:${t.reasonCodes.at(-1)}`
    reasons[k] = (reasons[k] ?? 0) + 1
  }
  const decades: Record<string, { supportingRecorded: number; b001Defer: Record<string, number>; marriages: number; births: number; deaths: number }> = {}
  for (const e of result.eventLog) {
    const d = String(Math.floor(e.year / 10) * 10)
    const x = (decades[d] ??= { supportingRecorded: 0, b001Defer: {}, marriages: 0, births: 0, deaths: 0 })
    if (e.eventType === 'PERSON_SUPPORTING_RECORD') x.supportingRecorded++
    if (e.eventType === 'MARRIAGE_REGISTER') x.marriages++
    if (e.eventType === 'PERSON_BIRTH') x.births++
    if (e.eventType === 'PERSON_DEATH') x.deaths++
  }
  for (const t of result.decisionTraces) {
    if (t.ruleId !== 'B-001' || t.status !== 'DEFER') continue
    const d = String(Math.floor(t.year / 10) * 10)
    const k = String(t.reasonCodes.at(-1))
    const x = decades[d] ??= { supportingRecorded: 0, b001Defer: {}, marriages: 0, births: 0, deaths: 0 }
    x.b001Defer[k] = (x.b001Defer[k] ?? 0) + 1
  }
  return {
    seed, ms, rssMB: Math.round(process.memoryUsage().rss / 1e6),
    status: result.status, years: result.transitions,
    persons: { total: recs.length, byOrigin: Object.fromEntries(['INITIAL_KEY', 'POPULATION_SUPPORTING', 'AUTONOMOUS_BIRTH', 'OTHER']
      .map(o => [o, recs.filter(r => r.origin === o).length])) },
    events: { marriages: count('MARRIAGE_REGISTER'), births: count('PERSON_BIRTH'), deaths: count('PERSON_DEATH'),
      supportingRecorded: count('PERSON_SUPPORTING_RECORD'), titleTransfers: count('LEGAL_TITLE_TRANSFER') },
    maxGeneration: Math.max(...recs.map(r => gen(r.personId))),
    byHouse: houses, reasons, decades,
    technicalGoal: result.technicalGoal?.status ?? null,
    aliveByDecade: result.snapshots.filter((_, i) => i % 10 === 0).map(s => `${s.year}:${s.persons.filter(p => p.alive).length}`).join(' '),
  }
}

describe('複数家門試遊構成: 初期世界と静的な構成', () => {
  const world = createMultiHouseWorld()
  it('国家3・地域6・人口集団10・家門6・重要人物8のまま、SUPPORTING/出生人物は初期に存在せず匿名出生履歴は空から蓄積', () => {
    expect([world.countries.length, world.regions.length, world.groups.length, world.houses.length, world.persons.length])
      .toEqual([3, 6, 10, 6, 8])
    expect(world.persons.every(p => p.interactionRole !== 'SUPPORTING' && p.fatherId === undefined || p.personId === 'person-exp-02' || p.personId === 'person-exp-03')).toBe(true)
    expect(world.demographics.anonymousBirthHistory).toEqual([])
    expect(world.year).toBe(1250)
    const base = createExperimentalWorld()
    expect(world.groups).toEqual(base.groups) // 人口を加算・減算していない
    expect(multiHousePersonRecords(world).map(r => r.origin)).toEqual(Array(8).fill('INITIAL_KEY'))
  })
  it('供給コホート: 全集団はエルディア4地方の有力層で、人口集団の人数を超えず、出典種別と生存確認IDを区別する', () => {
    const perGroup = new Map<string, number>()
    for (const c of MULTI_HOUSE_SUPPORTING_COHORTS) {
      expect(c.provenance).toBe('CALIBRATION_ONLY')
      perGroup.set(c.groupId, (perGroup.get(c.groupId) ?? 0) + c.memberCount)
      if (c.source === 'C004_COHORT') {
        expect(c.survivorAttestationId).toBeTruthy()
        expect(c.survivorAttestationId).not.toBe(c.sourceEvidenceId) // C004出生出典と独立した生存確認
        expect(c.birthYear).toBeGreaterThanOrEqual(1250)
      } else {
        expect(c.birthYear).toBeLessThan(1250)
        expect(c.survivorAttestationId).toBeUndefined()
      }
    }
    for (const [g, n] of perGroup) expect(n).toBeLessThan(world.groups.find(x => x.groupId === g)!.population)
    expect(new Set(MULTI_HOUSE_SUPPORTING_COHORTS.map(c => c.cohortId)).size).toBe(MULTI_HOUSE_SUPPORTING_COHORTS.length)
    expect(MULTI_HOUSE_SUPPORTING_LIMITS.maxRecordsPerYear).toBeLessThanOrEqual(4)
  })
  it('禁親証拠台帳: 人物ペア単位・異性・異家門・初期重要人物×供給候補のみ。familyPoolId等は証拠として使わない', () => {
    const initial = new Map(world.persons.map(p => [p.personId, p]))
    const cohortOf = new Map<string, (typeof MULTI_HOUSE_SUPPORTING_COHORTS)[number]>()
    for (const c of MULTI_HOUSE_SUPPORTING_COHORTS) {
      for (let i = 0; i < c.memberCount; i++) cohortOf.set(supportingCandidateId(c.cohortId, i), c)
    }
    expect(MULTI_HOUSE_SUPPORTING_CLEARANCES.length).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const cl of MULTI_HOUSE_SUPPORTING_CLEARANCES) {
      expect(ids.has(cl.clearanceId)).toBe(false)
      ids.add(cl.clearanceId)
      const [key, supporting] = cl.personIds.filter(x => initial.has(x)).concat(cl.personIds.filter(x => cohortOf.has(x)))
      expect(key && supporting).toBeTruthy()
      const person = initial.get(key!)!, cohort = cohortOf.get(supporting!)!
      expect(person.sex).not.toBe(cohort.sex)
      expect(person.houseId).not.toBe(cohort.affiliationHouseId)
      expect(cl.personIds[0] < cl.personIds[1]).toBe(true)
      expect(cl.sourceEvidenceId).not.toBe(cohort.sourceEvidenceId)
      expect(cl.sourceEvidenceId).not.toBe(cohort.survivorAttestationId)
      expect(cl.validUntilYear).toBeGreaterThan(cl.checkedYear)
    }
    // 実出生人物(IDが出生前に不明)を含むペアの証拠は与えない
    expect(MULTI_HOUSE_SUPPORTING_CLEARANCES.some(c => c.personIds.some(x => x.startsWith('person:b002')))).toBe(false)
  })
  it('構成identity: 評価器へ渡す実定数から導出され、既存統合構成と区別でき、決定的', () => {
    const id = multiHouseRunConfigIdentity() as Record<string, unknown>
    expect(id['configId']).toBe(MULTI_HOUSE_CONFIG_ID)
    expect(id['autonomy']).toEqual(MULTI_HOUSE_AUTONOMY)
    expect(id['b009']).toEqual(MULTI_HOUSE_B009_CALIBRATION)
    expect(id['nextgenContract']).toEqual(MULTI_HOUSE_NEXTGEN_CONTRACT)
    expect(id['trustBase']).toEqual(MULTI_HOUSE_TRUST_BASE)
    expect(id['supporting']).toEqual({ cohorts: MULTI_HOUSE_SUPPORTING_COHORTS, ...MULTI_HOUSE_SUPPORTING_LIMITS,
      kinshipClearances: MULTI_HOUSE_SUPPORTING_CLEARANCES })
    expect(id['world']).toEqual(createMultiHouseWorld())
    const trial = createExperimentalOrdinaryLegalTrial()
    expect(id['book']).toEqual(trial.book)
    expect(id['laws']).toEqual(trial.laws)
    expect(JSON.stringify(id)).not.toContain('seed')
    expect(JSON.stringify(multiHouseRunConfigIdentity())).toBe(JSON.stringify(id))
    expect(multiHouseRunConfigDigest()).toMatch(/^[0-9a-f]{16}$/)
    expect(multiHouseRunConfigDigest()).toBe(multiHouseRunConfigDigest())
    expect(JSON.stringify(integratedRunConfigIdentity())).not.toBe(JSON.stringify(id)) // 別構成のA0キャッシュと衝突しない
    expect(MULTI_HOUSE_RUN_CONDITIONS).toMatchObject({ startYear: 1250, endYear: 1350, primarySeed: MULTI_HOUSE_SEED })
    expect(MULTI_HOUSE_SEED).toBe(20260101)
    expect(MULTI_HOUSE_EXTRA_SEEDS.length).toBeLessThanOrEqual(3)
  })
  it('評価器factoryは startWorld と ledger から同一構成を生成し、構成identityはledgerに依存しない', () => {
    const w = createMultiHouseWorld()
    const a0 = createMultiHouseEvaluators(w, [])
    const a1 = createMultiHouseEvaluators(w, [trustCut(1262)])
    expect(Object.keys(a0).sort()).toEqual(Object.keys(a1).sort())
    expect(multiHouseRunConfigDigest()).toBe(multiHouseRunConfigDigest())
    expect(() => createMultiHouseEvaluators({ ...w, persons: [] } as WorldState, [trustCut(1262)])).toThrow(/INVALID_MULTI_HOUSE_EVALUATORS/)
  })
})

function trustCut(startYear: number): StatModifier {
  return {
    modifierId: 'multi-house:test:pair-trust-minus-20', interventionId: 'multi-house:test:intervene-' + startYear,
    targetRef: { kind: 'PERSON_PAIR', ids: ['person-exp-02', 'person-exp-05'] },
    statKey: PAIR_TRUST_STAT_KEY, signedDelta: -20, startYear, endExclusiveYear: startYear + 5, decayPolicy: 'NONE',
    ruleVersion: STAT_MODIFIER_RULE_VERSION,
  } as StatModifier
}

describe('主試遊seed 1250〜1350: 世代更新と不変条件（実計算）', () => {
  const main = () => cached(MULTI_HOUSE_SEED)
  it('100年完走し、初期世代→子→孫と複数世代の実出生が実際の記録から確認できる(観測値を出力)', () => {
    const { result, ms } = main()
    expect(result.status).toBe('COMPLETED')
    expect(result.snapshots).toHaveLength(101)
    expect(result.snapshots.at(-1)!.year).toBe(1350)
    const obs = observe(MULTI_HOUSE_SEED, result, ms)
    report('MULTI_HOUSE_OBSERVATION', obs)
    // 構成の目的(この主seedの観測): 実出生人物が成人し、その人物の子が生まれる(孫世代以降)
    expect(obs.maxGeneration).toBeGreaterThanOrEqual(2)
    expect(obs.persons.byOrigin['INITIAL_KEY']).toBe(8)
    expect(obs.persons.byOrigin['POPULATION_SUPPORTING']).toBeGreaterThan(0)
    expect(obs.persons.byOrigin['OTHER']).toBe(0)
  }, LONG)

  it('人物の出所区別・人口保存・出生枠・重複: 全年のWorldStateで成立する', () => {
    const { result } = main()
    const groupsAtStart = new Map(result.snapshots[0]!.groups.map(g => [g.groupId, g.population]))
    expect(groupsAtStart.size).toBe(10)
    for (const snap of result.snapshots) {
      const ids = snap.persons.map(p => p.personId)
      expect(new Set(ids).size).toBe(ids.length) // 同じ人物/候補の重複なし
      const supporting = snap.persons.filter(p => p.interactionRole === 'SUPPORTING')
      expect(supporting.filter(p => p.alive).length).toBeLessThanOrEqual(MULTI_HOUSE_SUPPORTING_LIMITS.maxAliveSupporting)
      for (const g of snap.groups) {
        // 記名人物は集団人口の内数で、人口を加算しない
        expect(snap.persons.filter(p => p.originGroupId === g.groupId && p.alive).length).toBeLessThanOrEqual(g.population)
      }
      // C004の同一集団・出生年の匿名出生枠を、複数コホート/補助人物で重複使用しない
      const backing = new Map((snap.demographics.anonymousBirthHistory ?? []).map(r => [`${r.groupId}@${r.year}`, r.anonymousBirths]))
      const usedByBirth = new Map<string, number>()
      for (const p of supporting) {
        if (p.birthYear < 1250) continue
        const k = `${p.originGroupId}@${p.birthYear}`
        usedByBirth.set(k, (usedByBirth.get(k) ?? 0) + 1)
      }
      for (const [k, n] of usedByBirth) expect(n).toBeLessThanOrEqual(backing.get(k) ?? 0)
    }
    // 補助人物は人物IDの規則どおりコホートの構成員として1回だけ個別化される
    const finalRecs = multiHousePersonRecords(result.snapshots.at(-1)!)
    for (const r of finalRecs.filter(x => x.origin === 'POPULATION_SUPPORTING')) {
      expect(r.population).not.toBeNull()
      expect(r.personId).toBe(supportingCandidateId(r.population!.cohortId, r.population!.memberOrdinal))
      if (r.population!.birthBacking === 'C004_COHORT') {
        expect(r.population!.survivorAttestationId).not.toBeNull()
        expect(r.population!.survivorAttestationId).not.toBe(r.population!.sourceEvidenceId)
      }
      expect(r.legalDynasty.status).toBe('UNDETERMINED') // 人口コホートは王朝所属の証明ではない
    }
  }, LONG)

  it('人口は候補供給の有無に関係なく同じ(個別化で人口を加算・減算しない)', () => {
    const { result } = main()
    const world = createMultiHouseWorld()
    const plain = runTimeline(world, {
      seed: MULTI_HOUSE_SEED, branchId: 'no-supply', goal: MULTI_HOUSE_GOAL, technicalGoalEvaluation: true,
      evaluators: createMultiHouseEvaluators(world, []),
    })
    expect(plain.status).toBe('COMPLETED')
    const noSupply = (() => {
      const evaluators = { ...createMultiHouseEvaluators(world, []) } as Record<string, unknown>
      delete evaluators['B-001']
      return runTimeline(world, { seed: MULTI_HOUSE_SEED, branchId: 'no-supply', goal: MULTI_HOUSE_GOAL,
        technicalGoalEvaluation: true, evaluators: evaluators as never })
    })()
    expect(noSupply.status).toBe('COMPLETED')
    for (let i = 0; i < result.snapshots.length; i++) {
      expect(result.snapshots[i]!.groups.map(g => g.population)).toEqual(noSupply.snapshots[i]!.groups.map(g => g.population))
    }
    expect(noSupply.snapshots.at(-1)!.persons.some(p => p.interactionRole === 'SUPPORTING')).toBe(false)
  }, LONG)

  it('婚姻: 登録された全婚姻が当年のWorldStateで禁親・重婚審査を通り、SUPPORTINGを含む場合は人物ペア証拠が実在する', () => {
    const { result } = main()
    const clearanceIds = new Set(MULTI_HOUSE_SUPPORTING_CLEARANCES.map(c => c.clearanceId))
    const marriages = result.eventLog.filter(e => e.eventType === 'MARRIAGE_REGISTER')
    expect(marriages.length).toBeGreaterThan(0)
    const active = new Map<string, number>() // person -> 同時ACTIVE婚姻数（重婚検出）
    for (const e of marriages) {
      const ref = e.involvedRefs.find(r => r.kind === 'PERSON_PAIR')
      expect(ref).toBeDefined()
      const ids = (ref as { ids: readonly [string, string] }).ids
      // 同年内に個別化・出生した人物を含むため、翌年初のWorldStateから当該婚姻だけを除き、登録年の状態として審査し直す。
      const next = result.snapshots.find(s => s.year === e.year + 1)!
      const start: WorldState = {
        ...next, year: e.year,
        persons: next.persons.map(p => ids.includes(p.personId) ? { ...p, alive: true } : p),
        legal: { ...next.legal, marriages: next.legal.marriages.filter(m => pairOf(m.personIds) !== pairOf(ids)) },
      }
      const review = reviewDomesticMarriageEligibility(start, [...ids].sort() as [string, string])
      expect(review.status, `${e.year} ${ids.join('+')}`).toBe('ELIGIBLE')
      const people = ids.map(id => start.persons.find(p => p.personId === id)!)
      if (people.some(p => p.interactionRole === 'SUPPORTING')) {
        const b005 = result.decisionTraces.find(t => t.year === e.year && t.ruleId === 'B-005' && t.status === 'ACCEPT'
          && t.actorRef.kind === 'PERSON_PAIR' && pairOf(t.actorRef.ids) === pairOf(ids))
        expect(b005, `B-005 ACCEPT ${e.year}`).toBeDefined()
        expect(clearanceIds.has(String(b005!.candidates[0]!.inputs['supportingKinshipClearanceId']))).toBe(true)
        expect(people.every(p => p.interactionRole === 'SUPPORTING' || !p.personId.startsWith('person:b002'))).toBe(true)
      }
      for (const id of ids) active.set(id, 0)
    }
    for (const snap of result.snapshots) {
      const n = new Map<string, number>()
      for (const m of snap.legal.marriages.filter(x => x.status === 'ACTIVE')) for (const id of m.personIds) n.set(id, (n.get(id) ?? 0) + 1)
      for (const [id, c] of n) expect(c, `${snap.year} ${id}`).toBe(1) // 重婚なし
    }
    // 実出生人物×SUPPORTINGの婚姻は証拠が無いので成立しない(DEFER/PENDINGを保持)
    const finalSnap = result.snapshots.at(-1)!
    const roles = new Map(finalSnap.persons.map(p => [p.personId, p.interactionRole === 'SUPPORTING' ? 'S' : p.personId.startsWith('person:b002') ? 'B' : 'K']))
    expect(finalSnap.legal.marriages.some(m => m.personIds.map(i => roles.get(i)).sort().join('') === 'BS')).toBe(false)
    const missing = result.decisionTraces.filter(t => t.ruleId === 'B-005' && t.reasonCodes.at(-1) === 'SUPPORTING_KINSHIP_CLEARANCE_MISSING')
    expect(missing.length).toBeGreaterThan(0)
    expect(missing.every(t => t.status === 'DEFER')).toBe(true)
  }, LONG)

  it('出生・家門・法的王朝: 親子は実在し、子の王朝は婚姻契約の明示条項だけで決まり暗黙の父系/母系既定値は無い', () => {
    const { result } = main()
    const final = result.snapshots.at(-1)!
    const byId = new Map(final.persons.map(p => [p.personId, p]))
    const born = final.persons.filter(p => p.personId.startsWith('person:b002'))
    expect(born.length).toBeGreaterThan(0)
    let determined = 0, undetermined = 0
    for (const c of born) {
      const f = byId.get(c.fatherId!), m = byId.get(c.motherId!)
      expect(f?.sex).toBe('MALE')
      expect(m?.sex).toBe('FEMALE')
      expect(c.birthYear - f!.birthYear).toBeGreaterThanOrEqual(18)
      expect(c.birthYear - m!.birthYear).toBeGreaterThanOrEqual(18)
      expect(c.houseId).toBe(m!.houseId) // B-002のCALIBRATION_ONLY実装(一般的な家門継承法ではない)
      expect(c.originGroupId).toBe(m!.originGroupId)
      const marriage = final.legal.marriages.find(x => pairOf(x.personIds) === pairOf([c.fatherId!, c.motherId!]))
      expect(marriage, `parents' marriage of ${c.personId}`).toBeDefined()
      expect(marriage!.registeredYear).toBeLessThanOrEqual(c.birthYear)
      const clause = marriage!.contract?.clauses.find(x => x.kind === 'CHILD_LEGAL_DYNASTY')
      if (clause) {
        expect(c.legalDynasty).toMatchObject({ status: 'DETERMINED', dynastyId: clause.dynastyId })
        determined++
      } else {
        expect(c.legalDynasty.status).toBe('UNDETERMINED')
        undetermined++
      }
    }
    report('MULTI_HOUSE_CHILD_DYNASTY', { determinedByClause: determined, undetermined })
  }, LONG)

  it('EventLog/DecisionTrace/WorldStateの整合: 記録件数と最終状態が一致する', () => {
    const { result } = main()
    const final = result.snapshots.at(-1)!
    const count = (t: string) => result.eventLog.filter(e => e.eventType === t).length
    expect(count('PERSON_BIRTH')).toBe(final.persons.filter(p => p.personId.startsWith('person:b002')).length)
    expect(count('PERSON_SUPPORTING_RECORD')).toBe(final.persons.filter(p => p.interactionRole === 'SUPPORTING').length)
    expect(count('PERSON_DEATH')).toBe(final.persons.filter(p => !p.alive).length)
    expect(count('MARRIAGE_REGISTER')).toBe(final.legal.marriages.length)
    // 各出生Eventは同年のB-002 ACCEPT Traceと対応する
    const births = result.decisionTraces.filter(t => t.ruleId === 'B-002' && t.status === 'ACCEPT')
    expect(births.length).toBe(count('PERSON_BIRTH'))
    // 称号・相続は実Eventから(固定年の予約なし): 発生していれば同年のA-SUC/A-TIT系Traceが存在する
    for (const e of result.eventLog.filter(x => x.eventType === 'LEGAL_TITLE_TRANSFER')) {
      expect(result.decisionTraces.some(t => t.year === e.year && ['A-SUC-04', 'A-TIT-07'].includes(t.ruleId))).toBe(true)
    }
  }, LONG)

  it('同構成・同seed・同ledgerは決定的(最終WorldState・EventLog・Traceが一致)', () => {
    const a = main().result
    const b = run(MULTI_HOUSE_SEED).result
    expect(b.eventLog).toEqual(a.eventLog)
    expect(b.decisionTraces).toEqual(a.decisionTraces)
    expect(b.snapshots.at(-1)).toEqual(a.snapshots.at(-1))
  }, LONG)

  it('A0/A1: 同じstartWorld・設定・identityで介入ledgerだけを変えて比較でき、介入前の年は完全に一致する', () => {
    const a0 = main().result
    const a1 = run(MULTI_HOUSE_SEED, [trustCut(1262)], 'multi-house-a1').result
    expect(a1.status).toBe('COMPLETED')
    for (let i = 0; i < 1262 - 1250; i++) expect(a1.snapshots[i]).toEqual(a0.snapshots[i]) // 1262年初まで同一
    expect(multiHouseRunConfigDigest()).toBe(multiHouseRunConfigDigest())
  }, LONG)
})

describe('固定seedの追加観測(成功例を選ばない・少数)', () => {
  for (const seed of MULTI_HOUSE_EXTRA_SEEDS) {
    it(`seed ${seed}: 完走し不変条件を満たす。世代の継続/停止は観測値としてそのまま出力する`, () => {
      const { result, ms } = cached(seed)
      expect(result.status).toBe('COMPLETED')
      for (const snap of result.snapshots) {
        const ids = snap.persons.map(p => p.personId)
        expect(new Set(ids).size).toBe(ids.length)
        const n = new Map<string, number>()
        for (const m of snap.legal.marriages.filter(x => x.status === 'ACTIVE')) for (const id of m.personIds) n.set(id, (n.get(id) ?? 0) + 1)
        for (const c of n.values()) expect(c).toBe(1)
      }
      const final = result.snapshots.at(-1)!
      expect(final.persons.filter(p => p.personId.startsWith('person:b002')).length)
        .toBe(result.eventLog.filter(e => e.eventType === 'PERSON_BIRTH').length)
      report('MULTI_HOUSE_OBSERVATION', observe(seed, result, ms))
    }, LONG)
  }
})

it('NALVEN_DYNASTY_IDはGoal用の技術評価対象であり、構成が特定王朝の勝利を予約しない(定数の参照のみ)', () => {
  expect(MULTI_HOUSE_GOAL).toEqual({ dynastyId: NALVEN_DYNASTY_ID })
})
