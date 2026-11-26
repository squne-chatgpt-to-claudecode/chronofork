// DEC-190 / Issue #206: 出生時の家門所属（父方原則・明示的な母方例外）を法的王朝・出身人口集団と分離して検証する。
// 実runYearのB-004→B-005→A-LEG-01→B-002→A-DYN-02経路を使い、婚姻・出生の手動注入だけで完了扱いしない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, createExperimentalOrdinaryLegalTrial, NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import * as experimental from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import type { ChildHouseAffiliationClause, Marriage, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { childHouseClauseIssue, resolveChildHouseAffiliation } from '../../../src/simulation/legal/child-house.ts'
import type { ChildHouseContractCalibration, NextgenContractCalibration } from '../../../src/simulation/legal/nextgen-contract.ts'
import { EXPERIMENTAL_NEXTGEN_CONTRACT, validateNextgenContractCalibration } from '../../../src/simulation/legal/nextgen-contract.ts'
import { reviewDomesticMarriageEligibility } from '../../../src/simulation/legal/nextgen-marriage.ts'
import { reviewAncestralHeir } from '../../../src/simulation/rules/a/legal-heirs.ts'
import { ANCESTRAL_HEIR_SEARCH_VERSION } from '../../../src/simulation/rules/a/legal-heirs.ts'
import { B002_AUTONOMOUS_VERSION, B002_PATERNAL_HOUSE_VERSION, B005_CHILD_HOUSE_VERSION } from '../../../src/simulation/rules/b/index.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'
import { baby, birth, newWorld, outcome, rejectionCodes, run } from '../engine/reducer/helpers.ts'

const P1 = 'person-exp-01', P2 = 'person-exp-02', P3 = 'person-exp-03', P4 = 'person-exp-04', P5 = 'person-exp-05'
const NALVEN = 'house-nalven', CARDON = 'house-cardon', VARGAS = 'house-vargas'
const trial = createExperimentalOrdinaryLegalTrial()
// 王朝条項の係数は既存DEC-058試験と同じ。家門係数は別オブジェクトで明示する（いずれもCALIBRATION_ONLY）。
const DYNASTY: NextgenContractCalibration = {
  ...EXPERIMENTAL_NEXTGEN_CONTRACT, ownDynastyBonus: 2, otherDynastyCost: 0, titleWeight: 4, noClauseCost: 5, supportWeight: 0,
}
const house = (x: Partial<ChildHouseContractCalibration>): ChildHouseContractCalibration => ({
  status: 'CALIBRATION_ONLY', version: 'test-child-house-calibration',
  ownHouseBonus: 0, otherHouseCost: 0, exceptionCost: 0, titleWeight: 0, supportWeight: 0, ...x,
})
/** 多家門v4構成と同じ家門係数。 */
const V4_HOUSE = experimental.MULTI_HOUSE_CHILD_HOUSE_CONTRACT
// 母方例外が成立し得る最小の試験値: 母が自家門をやや重視し、王朝条項の対価として家門を譲る構図（固定成功ではない）。
const TRADE_DYNASTY: NextgenContractCalibration = { ...DYNASTY, otherDynastyCost: 4 }
const TRADE_HOUSE = house({ ownHouseBonus: 3 })
const AUTO: AutonomyCalibration = {
  status: 'CALIBRATION_ONLY',
  birth: { minMotherAge: 18, maxMotherAge: 32, minFatherAge: 18, chancePermille: 1000 },
  death: { minAge: 60, riskStartAge: 59, basePermille: 0, increasePerYearPermille: 1000, maxPermille: 1000 },
  marriage: { minAdultAge: 18, maxCandidatePairs: 500 },
}

const evaluatorsFor = (world: WorldState, pairs: readonly (readonly [string, string])[], cal: NextgenContractCalibration,
  book = trial.book): EvaluatorMap => {
  const r = createAutonomousCalibrationEvaluators({
    branchStartWorld: world, ledger: [], trustBase: pairs.map(ids => ({ personIds: ids, value: 40 })),
    nextgenMarriage: { book, laws: trial.laws, calibration: cal }, autonomy: AUTO,
    ...(cal.childHouse ? { childHouseAffiliation: 'DEC190_PATERNAL_PRINCIPLE' as const } : {}),
  })
  if (!r.ok) throw new Error(r.issues.join('; '))
  return r.evaluators
}
type YearResult = ReturnType<typeof runYear>
const step = (world: WorldState, pairs: readonly (readonly [string, string])[], cal: NextgenContractCalibration,
  evaluators = evaluatorsFor(world, pairs, cal)): YearResult => runYear(world, { seed: 20260101, branchId: 'A0', evaluators })
const done = (r: YearResult) => {
  if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r.halt))
  return r
}
const childOf = (w: WorldState, f: string, m: string) => w.persons.filter(p => p.fatherId === f && p.motherId === m)
/** 出生Eventの実状態差分から、出生枠を請求した集団を数える（年末世界は当年枠を保持しない）。 */
const claimedSlotGroups = (r: YearResult) => done(r).events.filter(e => e.eventType === 'PERSON_BIRTH')
  .flatMap(e => e.stateChanges.map(c => /^\$\.demographics\.cohortSlots\[(.+)@\d+\]\.claimedBirths$/.exec(c.path)?.[1]).filter(Boolean))
const b005 = (r: YearResult, pair: readonly [string, string] = [P2, P5]) => done(r).traces.find(t => t.ruleId === 'B-005' &&
  t.actorRef.kind === 'PERSON_PAIR' && t.actorRef.ids.join() === [...pair].sort().join())!
const b002 = (r: YearResult) => done(r).traces.filter(t => t.ruleId === 'B-002')
/** 1250婚姻→1251出生を通常の年次経路で計算。 */
function marryThenBirth(cal: NextgenContractCalibration, pair: readonly [string, string] = [P2, P5], start = createExperimentalWorld()) {
  const marriageYear = done(step(start, [pair], cal))
  const birthYear = done(step(marriageYear.world, [pair], cal))
  return { marriageYear, birthYear }
}

describe('DEC-190 出生時の家門: 実年次経路（B004→B005→A-LEG-01→B002→A-DYN-02）', () => {
  it('家門条項なし: 父方家門・母側出身集団の出生枠・王朝条項は独立に適用される', () => {
    const { marriageYear, birthYear } = marryThenBirth({ ...DYNASTY, childHouse: V4_HOUSE })
    const marriage = marriageYear.world.legal.marriages[0]!
    expect(marriage.contract?.clauses.map(c => c.kind)).toEqual(['CHILD_LEGAL_DYNASTY'])
    const trace = b005(marriageYear)
    expect(trace.ruleVersion).toBe(B005_CHILD_HOUSE_VERSION)
    expect(trace.candidates[0]!.inputs.selectedContractKey).toBe('CHILD_DYNASTY:' + NALVEN_DYNASTY_ID)
    expect(trace.candidates[0]!.inputs.selectedChildHouse).toEqual({ basis: 'PATERNAL_DEFAULT', houseId: NALVEN })
    // 母方案も評価されたが、双方の利害から一意の最大相互利益にならなかったことを記録する。
    const options = trace.candidates[0]!.inputs.contractOptions as { key: string; childHouse: { basis: string } }[]
    expect(options.filter(o => o.childHouse.basis === 'MATERNAL_CONTRACT_CLAUSE').map(o => o.key))
      .toContain('CHILD_DYNASTY:' + NALVEN_DYNASTY_ID + '+CHILD_HOUSE:' + CARDON)
    const [child] = childOf(birthYear.world, P2, P5)
    expect(child).toMatchObject({ houseId: NALVEN, originGroupId: 'group-east-elite', birthYear: 1251,
      legalDynasty: { status: 'DETERMINED', dynastyId: NALVEN_DYNASTY_ID } })
    // 出生枠は母の出身集団だけで1件消費。父の集団・人口の二重計上はない。
    expect(claimedSlotGroups(birthYear)).toEqual(['group-east-elite'])
    const birthTrace = b002(birthYear).find(t => t.status === 'ACCEPT')!
    expect(birthTrace.ruleVersion).toBe(B002_PATERNAL_HOUSE_VERSION)
    expect(birthTrace.candidates[0]!.inputs).toMatchObject({ houseId: NALVEN, paternalHouseId: NALVEN, maternalHouseId: CARDON,
      childHouseBasis: 'PATERNAL_DEFAULT', childHouseClauseId: null, originGroupId: 'group-east-elite' })
    // 既存の父母の家門・出自は婚姻・出生で変わらない。
    for (const id of [P2, P5]) {
      const before = createExperimentalWorld().persons.find(p => p.personId === id)!
      expect(birthYear.world.persons.find(p => p.personId === id)).toMatchObject({ houseId: before.houseId, originGroupId: before.originGroupId })
    }
    expect(validateWorldState(birthYear.world).ok).toBe(true)
  })

  it('旧版（母の家門）は同じ入力で従来どおり。乱数・子ID・出生枠は新版と同一', () => {
    const legacy = marryThenBirth(DYNASTY).birthYear
    const paternal = marryThenBirth({ ...DYNASTY, childHouse: V4_HOUSE }).birthYear
    const [a] = childOf(legacy.world, P2, P5), [b] = childOf(paternal.world, P2, P5)
    expect(a!.houseId).toBe(CARDON)
    expect(b!.houseId).toBe(NALVEN)
    const { houseId: _a, ...restA } = a!, { houseId: _b, ...restB } = b!
    void [_a, _b]
    expect(restA).toEqual(restB)
    const [la] = b002(legacy), [pa] = b002(paternal)
    expect(la!.ruleVersion).toBe(B002_AUTONOMOUS_VERSION)
    expect(la!.random).toEqual(pa!.random)
    expect(la!.candidates[0]!.inputs).not.toHaveProperty('childHouseBasis')
  })

  it('双方合意の母方例外（王朝条項あり）: 子は母の家門、法的王朝は王朝条項、出生枠は母の集団', () => {
    const { marriageYear, birthYear } = marryThenBirth({ ...TRADE_DYNASTY, childHouse: TRADE_HOUSE })
    const marriage = marriageYear.world.legal.marriages[0]!
    const trace = b005(marriageYear)
    expect(trace.candidates[0]!.inputs.selectedContractKey).toBe('CHILD_DYNASTY:' + NALVEN_DYNASTY_ID + '+CHILD_HOUSE:' + CARDON)
    expect(trace.candidates[0]!.inputs.selectedChildHouse).toEqual({ basis: 'MATERNAL_CONTRACT_CLAUSE', houseId: CARDON, sourcePersonId: P5 })
    expect(marriage.contract?.clauses).toMatchObject([
      { kind: 'CHILD_LEGAL_DYNASTY', dynastyId: NALVEN_DYNASTY_ID },
      { kind: 'CHILD_HOUSE_AFFILIATION', houseId: CARDON, sourcePersonId: P5 },
    ])
    const aLeg = marriageYear.traces.find(t => t.ruleId === 'A-LEG-01' && t.status === 'ACCEPT')!
    expect(aLeg.candidates[0]!.inputs.contractId).toBe(marriage.contract!.contractId)
    const [child] = childOf(birthYear.world, P2, P5)
    expect(child).toMatchObject({ houseId: CARDON, originGroupId: 'group-east-elite',
      legalDynasty: { status: 'DETERMINED', dynastyId: NALVEN_DYNASTY_ID } })
    const accepted = b002(birthYear).find(t => t.status === 'ACCEPT')!
    expect(accepted.candidates[0]!.inputs).toMatchObject({ childHouseBasis: 'MATERNAL_CONTRACT_CLAUSE',
      childHouseClauseId: marriage.contract!.clauses[1]!.clauseId, contractId: marriage.contract!.contractId })
    expect(claimedSlotGroups(birthYear)).toEqual(['group-east-elite'])
    // 同一婚姻の後続出生も同じ根拠を使う。
    const third = done(step(birthYear.world, [[P2, P5]], { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE }))
    expect(childOf(third.world, P2, P5).map(p => p.houseId)).toEqual([CARDON, CARDON])
  })

  it('王朝条項なし・家門条項なし: 父方家門、法的王朝はUNDETERMINED（父系王朝を既定にしない）', () => {
    const cal = { ...DYNASTY, noClauseCost: -20, childHouse: V4_HOUSE }
    const { marriageYear, birthYear } = marryThenBirth(cal)
    expect(marriageYear.world.legal.marriages[0]!.contract?.clauses).toEqual([])
    const [child] = childOf(birthYear.world, P2, P5)
    expect(child!.houseId).toBe(NALVEN)
    expect(child!.legalDynasty.status).toBe('UNDETERMINED')
    const dyn = birthYear.traces.find(t => t.ruleId === 'A-DYN-02')!
    expect(dyn.reasonCodes).toContain('GAME_01_DYNASTY_CLAUSE_MISSING')
  })

  it('王朝条項なし・家門条項あり: 母方家門でも法的王朝は確定しない（家門条項から王朝を導かない）', () => {
    // 母P3の家門（ナルヴェン）は記録上の世襲Titleを多く持つ。家門の称号利害だけで双方が母方を選ぶ試験値。
    const cal = { ...DYNASTY, noClauseCost: -20, childHouse: house({ titleWeight: 4 }) }
    const w1251 = done(step(createExperimentalWorld(), [[P3, P4]], cal)).world
    expect(w1251.legal.marriages).toHaveLength(0) // P3は1250年に未成年
    const { marriageYear, birthYear } = marryThenBirth(cal, [P3, P4], w1251)
    expect(marriageYear.world.legal.marriages[0]!.contract?.clauses).toMatchObject([
      { kind: 'CHILD_HOUSE_AFFILIATION', houseId: NALVEN, sourcePersonId: P3 }])
    const [child] = childOf(birthYear.world, P4, P3)
    expect(child).toMatchObject({ houseId: NALVEN, originGroupId: 'group-central-elite', legalDynasty: { status: 'UNDETERMINED' } })
    expect(birthYear.traces.find(t => t.ruleId === 'A-DYN-02')!.reasonCodes).toContain('GAME_01_DYNASTY_CLAUSE_MISSING')
  })

  it('翌世代: 国内管轄照会は子の新しいhouseIdを使い、傍系継承の実評価器は家門と無関係に親子記録で探索する', () => {
    const w = marryThenBirth({ ...TRADE_DYNASTY, childHouse: TRADE_HOUSE }).birthYear.world
    const child = childOf(w, P2, P5)[0]!
    expect(child.houseId).toBe(CARDON)
    // 子と血縁記録の無い異性の成人（ヴァルガス家門）。管轄国は子の家門から決まり、出身集団で代用しない。
    const partner = { ...w.persons.find(p => p.personId === P4)!, personId: 'synthetic-partner', name: '試験相手',
      sex: child.sex === 'MALE' ? 'FEMALE' as const : 'MALE' as const, birthYear: child.birthYear }
    const adult: WorldState = { ...w, year: child.birthYear + 18, persons: [...w.persons, partner] }
    const pair = [child.personId, partner.personId].sort() as [string, string]
    expect(reviewDomesticMarriageEligibility(adult, pair)).toMatchObject({ status: 'ELIGIBLE', countryId: 'country-eldia' })
    const foreign: WorldState = { ...adult, houses: adult.houses.map(h => h.houseId === CARDON ? { ...h, countryId: 'country-margald' } : h) }
    expect(reviewDomesticMarriageEligibility(foreign, pair).status).not.toBe('ELIGIBLE')
    // 父P2の死亡時、子は家門（カルドン）に関係なく直系の記録から審査される。
    const dead: WorldState = { ...w, persons: w.persons.map(p => p.personId === P2 ? { ...p, alive: false, deathYear: w.year } : p) }
    const heir = reviewAncestralHeir(dead, P2)
    expect(heir.rankedCandidateIds[0]).toBe(child.personId)
  })
})

describe('DEC-190 不成立・不正な例外', () => {
  const maternal = (w: WorldState, x: Partial<ChildHouseAffiliationClause>): WorldState => ({ ...w, legal: { ...w.legal,
    marriages: w.legal.marriages.map((m): Marriage => ({ ...m, contract: { ...m.contract!, clauses: [...m.contract!.clauses,
      { clauseId: 'tampered-house', kind: 'CHILD_HOUSE_AFFILIATION', houseId: CARDON, sourcePersonId: P5, ...x }] } })) } })
  const married = () => done(step(createExperimentalWorld(), [[P2, P5]], { ...DYNASTY, childHouse: V4_HOUSE })).world

  it.each([
    ['第三者家門', { houseId: VARGAS }, 'CHILD_HOUSE_NOT_MATERNAL_HOUSE'],
    ['父方と同じ重複案', { houseId: NALVEN }, 'CHILD_HOUSE_NOT_MATERNAL_HOUSE'],
    ['出典が父', { sourcePersonId: P2, houseId: NALVEN }, 'CHILD_HOUSE_SOURCE_NOT_MOTHER'],
  ] as const)('登録済み契約の%s条項は出生を保留し、父方fallback・人物・出生枠消費をしない', (_n, x, code) => {
    const w = maternal(married(), x)
    expect(validateWorldState(w).ok).toBe(true)
    const r = done(step(w, [[P2, P5]], { ...DYNASTY, childHouse: V4_HOUSE }))
    expect(childOf(r.world, P2, P5)).toHaveLength(0)
    expect(claimedSlotGroups(r)).toEqual([])
    const slot = r.traces.find(t => t.ruleId === 'B-002')!.candidates[0]!.inputs
    expect(slot).toMatchObject({ claimedBirths: 0, houseId: null, childHouseBasis: null })
    expect(r.events.filter(e => e.eventType === 'PERSON_BIRTH')).toHaveLength(0)
    const t = b002(r)[0]!
    expect(t.status).toBe('DEFER')
    expect(t.reasonCodes).toContain(code)
    expect(r.world.persons.find(p => p.personId === P5)!.houseId).toBe(CARDON)
  })

  it('管轄外の母方家門・複数条項・契約証拠欠落は解決しない', () => {
    const w = maternal(married(), {})
    const m = w.legal.marriages[0]!
    const [f, mo] = [P2, P5].map(id => w.persons.find(p => p.personId === id)!) as [never, never]
    expect(resolveChildHouseAffiliation(w, f, mo, m)).toMatchObject({ status: 'RESOLVED', houseId: CARDON, basis: 'MATERNAL_CONTRACT_CLAUSE' })
    const foreign = { ...w, houses: w.houses.map(h => h.houseId === CARDON ? { ...h, countryId: 'country-margald' } : h) }
    expect(resolveChildHouseAffiliation(foreign, f, mo, m)).toEqual({ status: 'UNRESOLVED', reasonCode: 'CHILD_HOUSE_JURISDICTION_MISMATCH' })
    const twice = maternal(w, { clauseId: 'second' })
    expect(resolveChildHouseAffiliation(twice, f, mo, twice.legal.marriages[0]!)).toEqual({ status: 'UNRESOLVED', reasonCode: 'AMBIGUOUS_CHILD_HOUSE_CLAUSES' })
    expect(validateWorldState(twice).diagnostics.map(i => i.code)).toContain('MARRIAGE_CLAUSE_CONFLICT')
    const noEvidence = { ...m, contract: { ...m.contract!, evidenceId: '' } }
    expect(resolveChildHouseAffiliation(w, f, mo, noEvidence)).toEqual({ status: 'UNRESOLVED', reasonCode: 'MARRIAGE_CONTRACT_EVIDENCE_MISSING' })
    const unknown = { ...w, houses: w.houses.filter(h => h.houseId !== CARDON) }
    expect(childHouseClauseIssue(unknown, [f, mo], m.contract!.clauses[1] as ChildHouseAffiliationClause)).toBe('CHILD_HOUSE_UNKNOWN')
  })

  it('片方の同意なし: 例外費用が大きいと母方案は双方同意にならず、父方の既定で成立する', () => {
    const r = done(step(createExperimentalWorld(), [[P2, P5]], { ...TRADE_DYNASTY, childHouse: house({ ownHouseBonus: 3, exceptionCost: 100 }) }))
    const options = b005(r).candidates[0]!.inputs.contractOptions as { childHouse: { basis: string }; mutuallyAccepted: boolean }[]
    expect(options.filter(o => o.childHouse.basis === 'MATERNAL_CONTRACT_CLAUSE').every(o => !o.mutuallyAccepted)).toBe(true)
    expect(r.world.legal.marriages[0]!.contract?.clauses.map(c => c.kind)).toEqual(['CHILD_LEGAL_DYNASTY'])
  })

  it('得点同率（家門利害なし）なら母方/父方をID順で決めず、婚姻を保留する', () => {
    const r = done(step(createExperimentalWorld(), [[P2, P5]], { ...DYNASTY, childHouse: house({}) }))
    expect(r.world.legal.marriages).toHaveLength(0)
    expect(b005(r).reasonCodes).toContain('CONTRACT_CHOICE_TIE')
  })

  it('無授権ではB-005の母方合意だけで婚姻・条項を作らない', () => {
    const cal = { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE }
    const world = createExperimentalWorld()
    const book = { ...trial.book, approvalAuthorities: [] }
    const r = done(step(world, [[P2, P5]], cal, evaluatorsFor(world, [[P2, P5]], cal, book)))
    expect(b005(r).status).toBe('ACCEPT')
    expect(r.world.legal.marriages).toHaveLength(0)
    expect(r.events.filter(e => e.eventType === 'MARRIAGE_REGISTER')).toHaveLength(0)
  })

  it('Aの同一入力再評価が家門条項の選択と一致しなければ登録しない', () => {
    const world = createExperimentalWorld()
    const b = evaluatorsFor(world, [[P2, P5]], { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE })
    const a = evaluatorsFor(world, [[P2, P5]], { ...TRADE_DYNASTY, childHouse: { ...TRADE_HOUSE, ownHouseBonus: 2 } })
    const r = done(step(world, [[P2, P5]], DYNASTY, { ...a, 'B-005': b['B-005']! }))
    expect(b005(r).status).toBe('ACCEPT')
    expect(r.world.legal.marriages).toHaveLength(0)
  })

  it('B-002の家門方式と契約の家門係数は一体で選ぶ（片方だけの構成を拒否）', () => {
    const base = { branchStartWorld: createExperimentalWorld(), ledger: [], trustBase: [], autonomy: AUTO }
    expect(createAutonomousCalibrationEvaluators({ ...base, nextgenMarriage: { book: trial.book, laws: trial.laws,
      calibration: { ...DYNASTY, childHouse: V4_HOUSE } } })).toEqual({ ok: false, issues: ['CHILD_HOUSE_MODE_MISMATCH'] })
    expect(createAutonomousCalibrationEvaluators({ ...base, nextgenMarriage: { book: trial.book, laws: trial.laws, calibration: DYNASTY },
      childHouseAffiliation: 'DEC190_PATERNAL_PRINCIPLE' })).toEqual({ ok: false, issues: ['CHILD_HOUSE_MODE_MISMATCH'] })
    expect(validateNextgenContractCalibration({ ...DYNASTY, childHouse: { ...V4_HOUSE, status: 'FORMAL' as never } }))
      .toEqual(['CHILD_HOUSE_CALIBRATION_NOT_EXPERIMENTAL'])
    expect(validateNextgenContractCalibration({ ...DYNASTY, childHouse: { ...V4_HOUSE, exceptionCost: 0.5 } }))
      .toEqual(['CHILD_HOUSE_CALIBRATION_OUT_OF_RANGE'])
  })

  it('reducer: 家門条項のある婚姻の出生は条項の解決結果と一致する家門でのみ登録する', () => {
    const marriage: Marriage = { marriageId: 'm-25', personIds: [P2, P5], registeredYear: 1250, status: 'ACTIVE',
      contract: { contractId: 'c-25', evidenceId: 'e-25', clauses: [
        { clauseId: 'h-25', kind: 'CHILD_HOUSE_AFFILIATION', houseId: CARDON, sourcePersonId: P5 }] } }
    const base = newWorld()
    const w: WorldState = { ...base, legal: { ...base.legal, marriages: [marriage] },
      demographics: { cohortSlots: [{ groupId: 'group-east-elite', year: 1250, birthSlots: 1, deathSlots: 0, claimedBirths: 0, claimedDeaths: 0 }] } }
    const child = (houseId: string) => baby('child-25', 'group-east-elite', { houseId, motherId: P5 })
    const bad = run(w, outcome('B-002', 3, [birth(child(NALVEN))]))
    expect(rejectionCodes(bad)).toContain('LEGAL_BASIS_MISSING')
    expect(bad.world.persons.some(p => p.personId === 'child-25')).toBe(false)
    const good = run(w, outcome('B-002', 3, [birth(child(CARDON))]))
    expect(good.world.persons.find(p => p.personId === 'child-25')?.houseId).toBe(CARDON)
    expect(rejectionCodes(run(w, outcome('B-002', 3, [birth(child('house-ghost'))])))).toContain('NOT_FOUND')
  })
})

describe('DEC-190 保存・parse・版付き構成', () => {
  it('家門条項はparseで往復し、旧JSONの王朝条項は不変。未知フィールド・王朝IDの混入は拒否', () => {
    const w = maternalWorld()
    const parsed = validateWorldState(JSON.parse(JSON.stringify(w)))
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.world).toEqual(w)
    const bad = JSON.parse(JSON.stringify(w))
    bad.legal.marriages[0].contract.clauses[1].dynastyId = NALVEN_DYNASTY_ID
    expect(validateWorldState(bad).diagnostics.map(i => i.code)).toContain('UNKNOWN_FIELD')
    const missing = JSON.parse(JSON.stringify(w))
    delete missing.legal.marriages[0].contract.clauses[1].sourcePersonId
    expect(validateWorldState(missing).diagnostics.map(i => i.code)).toContain('MISSING_FIELD')
    const outsider = JSON.parse(JSON.stringify(w))
    outsider.legal.marriages[0].contract.clauses[1].sourcePersonId = P1
    expect(validateWorldState(outsider).diagnostics.map(i => i.code)).toContain('MARRIAGE_CLAUSE_CONFLICT')
  })

  it('v0〜v3と限定試遊のdigestを変えず、v4は家門所属・契約係数・版だけが異なる', () => {
    const x = experimental
    expect(x.multiHouseDemandRunConfigDigest(0)).toBe('844299b001142fee')
    expect(x.multiHouseDemandRunConfigDigest(1)).toBe('d8260d46ed460630')
    expect(x.multiHouseAncestralRunConfigDigest(0)).toBe('1eb440a45a2680e0')
    expect(x.multiHouseAncestralRunConfigDigest(1)).toBe('fbadbdda8861ae7a')
    const v3 = x.multiHouseAncestralRunConfigIdentity(0) as Record<string, unknown>
    const v4 = x.multiHouseChildHouseRunConfigIdentity(0) as Record<string, unknown>
    expect(v4.configId).toBe('experimental-multi-house-v4-dec190-paternal-house-drift-0')
    const changed = [...new Set([...Object.keys(v3), ...Object.keys(v4)])].filter(k => JSON.stringify(v4[k]) !== JSON.stringify(v3[k])).sort()
    expect(changed).toEqual(['childHouseAffiliation', 'configId', 'nextgenContract', 'ruleVersions'])
    expect(v4.nextgenContract).toEqual({ ...v3.nextgenContract as object, childHouse: x.MULTI_HOUSE_CHILD_HOUSE_CONTRACT })
    expect((v4.ruleVersions as Record<string, unknown>).heirSearch).toBe(ANCESTRAL_HEIR_SEARCH_VERSION)
    expect(v4.world).toEqual(x.createMultiHouseDemandWorld(0))
    expect(new Set([x.multiHouseChildHouseRunConfigDigest(0), x.multiHouseChildHouseRunConfigDigest(1), x.multiHouseAncestralRunConfigDigest(0)]).size).toBe(3)
  })
})

function maternalWorld(): WorldState {
  const base = createExperimentalWorld()
  return { ...base, legal: { ...base.legal, marriages: [{ marriageId: 'm-p', personIds: [P2, P5], registeredYear: 1250, status: 'ACTIVE',
    contract: { contractId: 'c-p', evidenceId: 'e-p', clauses: [
      { clauseId: 'd-p', kind: 'CHILD_LEGAL_DYNASTY', dynastyId: NALVEN_DYNASTY_ID },
      { clauseId: 'h-p', kind: 'CHILD_HOUSE_AFFILIATION', houseId: CARDON, sourcePersonId: P5 }] } }] } }
}
