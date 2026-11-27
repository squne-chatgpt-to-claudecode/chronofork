// DEC-190 / Issue #206: 出生時の家門所属（父方原則・明示的な母方例外）を法的王朝・出身人口集団と分離して検証する。
// 実runYearのB-004→B-005→A-LEG-01→B-002→A-DYN-02経路を使い、婚姻・出生の手動注入だけで完了扱いしない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, createExperimentalOrdinaryLegalTrial, NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import * as experimental from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import type { ChildHouseAffiliationClause, ChildHouseAgreementRecord, Marriage, MarriageContract, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { childHouseAgreementIssue, childHouseClauseIssue, childHouseRegistrationIssue, resolveChildHouseAffiliation }
  from '../../../src/simulation/legal/child-house.ts'
import { nextgenMarriageContract } from '../../../src/simulation/legal/nextgen-contract-ids.ts'
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
  type Tamper = (c: ChildHouseAffiliationClause) => ChildHouseAffiliationClause
  const TRADE = { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE }
  /** 父方案で正規に登録された婚姻（家門条項なし）。 */
  const married = () => done(step(createExperimentalWorld(), [[P2, P5]], { ...DYNASTY, childHouse: V4_HOUSE })).world
  /** 実年次経路の双方合意で正規に成立した母方例外の婚姻と、その年のTrace。 */
  const maternalYear = () => done(step(createExperimentalWorld(), [[P2, P5]], TRADE))
  const withContract = (w: WorldState, f: (c: MarriageContract) => MarriageContract, m = (x: Marriage) => x): WorldState =>
    ({ ...w, legal: { ...w.legal, marriages: w.legal.marriages.map((x): Marriage => m({ ...x, contract: f(x.contract!) })) } })
  const houseClause = (w: WorldState) => w.legal.marriages[0]!.contract!.clauses.find(c => c.kind === 'CHILD_HOUSE_AFFILIATION')!
  const tamper = (w: WorldState, f: Tamper): WorldState => withContract(w, c => ({ ...c,
    clauses: c.clauses.map(x => x.kind === 'CHILD_HOUSE_AFFILIATION' ? f(x) : x) }))
  /** 父方案の登録済み契約へ、元の契約ID・証拠IDのまま母方条項を後付けする。 */
  const appended = (w: WorldState, clause: unknown): WorldState => withContract(w, c => ({ ...c,
    clauses: [...c.clauses, clause as ChildHouseAffiliationClause] }))
  /** 出生年の実評価: 子・出生Event・出生枠請求がなく、DEFERで理由を記録し、母の家門も変わらない。 */
  const expectBirthDeferred = (w: WorldState, code: string) => {
    expect(validateWorldState(w).ok).toBe(true)
    const r = done(step(w, [[P2, P5]], TRADE))
    expect(childOf(r.world, P2, P5)).toHaveLength(0)
    expect(claimedSlotGroups(r)).toEqual([])
    expect(r.events.filter(e => e.eventType === 'PERSON_BIRTH')).toHaveLength(0)
    const t = b002(r)[0]!
    expect(t.status).toBe('DEFER')
    expect(t.reasonCodes).toContain(code)
    expect(t.candidates[0]!.inputs).toMatchObject({ claimedBirths: 0, houseId: null, childHouseBasis: null })
    expect(r.world.persons.find(p => p.personId === P5)!.houseId).toBe(CARDON)
  }

  it('正規の母方例外: 登録時の合意記録はB-005の当年Traceと一致し、Aの登録審査・出生時の結合照合を通る', () => {
    const y = maternalYear(), w = y.world
    const m = w.legal.marriages[0]!, clause = houseClause(w)
    const trace = b005(y)
    expect(clause.agreement).toEqual({ registeredYear: 1250, personIds: [P2, P5], sourceTraceId: trace.traceId,
      contractKey: 'CHILD_DYNASTY:' + NALVEN_DYNASTY_ID + '+CHILD_HOUSE:' + CARDON, dynastyId: NALVEN_DYNASTY_ID,
      firstConsentScore: clause.agreement.firstConsentScore, secondConsentScore: clause.agreement.secondConsentScore,
      consentThreshold: TRADE.consentThreshold })
    const option = (trace.candidates[0]!.inputs.contractOptions as Record<string, unknown>[]).find(o => o.key === clause.agreement.contractKey)!
    expect(option).toMatchObject({ mutuallyAccepted: true, firstConsentScore: clause.agreement.firstConsentScore,
      secondConsentScore: clause.agreement.secondConsentScore })
    expect(m.contract!.evidenceId).toBe('evidence:nextgen-agreement:' + trace.traceId)
    expect(childHouseAgreementIssue(m, m.contract)).toBeNull()
    const [f, mo] = [P2, P5].map(id => w.persons.find(p => p.personId === id)!) as [never, never]
    expect(childHouseRegistrationIssue(w, 1250, [P2, P5], [f, mo], m.contract, y.traces)).toBeNull()
    expect(resolveChildHouseAffiliation(w, f, mo, m)).toMatchObject({ status: 'RESOLVED', houseId: CARDON, basis: 'MATERNAL_CONTRACT_CLAUSE' })
  })

  it('Aの登録審査: 当年のB-005合意Traceが無い・一致しない手動の家門条項契約は登録しない', () => {
    const y = maternalYear(), w = y.world
    const m = w.legal.marriages[0]!
    const parties = [P2, P5].map(id => w.persons.find(p => p.personId === id)!) as [never, never]
    const review = (contract: MarriageContract | undefined, traces = y.traces, year = 1250) =>
      childHouseRegistrationIssue(w, year, [P2, P5], parties, contract, traces)
    // 合意記録と契約の形は自己整合でも、Traceが無い手動候補・承認記録は証明にならない。
    expect(review(m.contract, [])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISSING')
    expect(review(m.contract, y.traces.filter(t => t.ruleId !== 'B-005'))).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISSING')
    const trace = b005(y)
    const deferred = { ...trace, status: 'DEFER' as const }
    expect(review(m.contract, [deferred])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISSING')
    expect(review(m.contract, [trace], 1251)).toBe('CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH')
    // 得点の書換えは合意記録の結合だけでは検出できないため、登録時にTraceの選択案と照合する。
    const scores = tamper(w, c => ({ ...c, agreement: { ...c.agreement, firstConsentScore: c.agreement.firstConsentScore + 1 } }))
    expect(review(scores.legal.marriages[0]!.contract, [trace])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    const otherChoice = { ...trace, candidates: [{ ...trace.candidates[0]!, inputs: { ...trace.candidates[0]!.inputs,
      selectedContractKey: 'CHILD_DYNASTY:' + NALVEN_DYNASTY_ID, selectedChildHouse: { basis: 'PATERNAL_DEFAULT', houseId: NALVEN } } }] }
    expect(review(m.contract, [otherChoice])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(review(appended(married(), { ...houseClause(w) }).legal.marriages[0]!.contract, [trace]))
      .toBe('CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH')
  })

  it('合意記録なしで父方案の契約へ後付けした母方条項は解決せず、年次計算も出生しない（父方fallbackなし）', () => {
    const w = appended(married(), { clauseId: 'tampered-house', kind: 'CHILD_HOUSE_AFFILIATION', houseId: CARDON, sourcePersonId: P5 })
    const m = w.legal.marriages[0]!
    const [f, mo] = [P2, P5].map(id => w.persons.find(p => p.personId === id)!) as [never, never]
    expect(resolveChildHouseAffiliation(w, f, mo, m)).toEqual({ status: 'UNRESOLVED', reasonCode: 'CHILD_HOUSE_AGREEMENT_MISSING' })
    expect(validateWorldState(JSON.parse(JSON.stringify(w))).diagnostics.map(i => i.code)).toContain('MISSING_FIELD')
    // 記録の無い条項は保存形式として不正。年次計算は入力検証で停止し、出生・出生枠請求を作らない。
    const r = step(w, [[P2, P5]], TRADE)
    expect(r.status).toBe('HALTED')
    expect(r.status === 'HALTED' && r.halt.code).toBe('INVALID_INPUT_WORLD')
    expect(childOf(r.world, P2, P5)).toHaveLength(0)
  })

  it.each([
    // 正規の母方婚姻の条項・合意記録を他婚姻へ流用（元の契約ID・証拠IDのまま）。
    ['正規の合意記録を父方案の契約へ後付け', (w: WorldState) => appended(married(), houseClause(w)), 'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    // 父方案の契約ID・証拠IDと矛盾しない自己申告の記録を作っても、Aの発行する母方案の契約IDとは一致しない。
    ['父方案の契約に自己申告の合意記録を後付け', () => {
      const p = married(), c = p.legal.marriages[0]!.contract!
      const agreement: ChildHouseAgreementRecord = { registeredYear: 1250, personIds: [P2, P5],
        sourceTraceId: c.evidenceId.replace('evidence:nextgen-agreement:', ''),
        contractKey: 'CHILD_DYNASTY:' + NALVEN_DYNASTY_ID + '+CHILD_HOUSE:' + CARDON, dynastyId: NALVEN_DYNASTY_ID,
        firstConsentScore: 100, secondConsentScore: 100, consentThreshold: 15 }
      return appended(p, { clauseId: 'tampered-house', kind: 'CHILD_HOUSE_AFFILIATION', houseId: CARDON, sourcePersonId: P5, agreement })
    }, 'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['条項IDの改変', (w: WorldState) => tamper(w, c => ({ ...c, clauseId: 'tampered-house' })), 'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['同じ契約の王朝条項の改変', (w: WorldState) => withContract(w, c => ({ ...c, clauses: c.clauses.filter(x => x.kind !== 'CHILD_LEGAL_DYNASTY') })),
      'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['合意案キーの改変', (w: WorldState) => tamper(w, c => ({ ...c, agreement: { ...c.agreement, contractKey: 'NO_CLAUSE+CHILD_HOUSE:' + CARDON } })),
      'CHILD_HOUSE_AGREEMENT_KEY_MISMATCH'],
    ['別Traceの証拠へ差替え', (w: WorldState) => tamper(w, c => ({ ...c, agreement: { ...c.agreement, sourceTraceId: 'trace:other' } })),
      'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['片方の得点が閾値未満', (w: WorldState) => tamper(w, c => ({ ...c, agreement: { ...c.agreement, secondConsentScore: c.agreement.consentThreshold - 1 } })),
      'CHILD_HOUSE_AGREEMENT_CONSENT_MISSING'],
    ['別年の記録', (w: WorldState) => tamper(w, c => ({ ...c, agreement: { ...c.agreement, registeredYear: 1249 } })),
      'CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH'],
    ['婚姻の登録年を別年へ', (w: WorldState) => withContract(w, c => c, m => ({ ...m, registeredYear: 1249 })),
      'CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH'],
    ['第三者家門', (w: WorldState) => tamper(w, c => ({ ...c, houseId: VARGAS })), 'CHILD_HOUSE_NOT_MATERNAL_HOUSE'],
    ['父方と同じ重複案', (w: WorldState) => tamper(w, c => ({ ...c, houseId: NALVEN })), 'CHILD_HOUSE_NOT_MATERNAL_HOUSE'],
    ['出典が父', (w: WorldState) => tamper(w, c => ({ ...c, sourcePersonId: P2, houseId: NALVEN })), 'CHILD_HOUSE_SOURCE_NOT_MOTHER'],
  ] as const)('%sは出生を保留し、父方fallback・人物・出生枠消費をしない', (_n, make, code) => {
    expectBirthDeferred(make(maternalYear().world), code)
  })

  it('別ペアの婚姻への合意記録の流用は解決しない', () => {
    const w = maternalYear().world
    const m = w.legal.marriages[0]!
    const other: Marriage = { ...m, marriageId: 'm-other', personIds: [P4, P5] }
    expect(childHouseAgreementIssue(other, m.contract)).toBe('CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH')
  })

  it('管轄外の母方家門・複数条項・契約証拠欠落は解決しない', () => {
    const w = maternalYear().world
    const m = w.legal.marriages[0]!
    const [f, mo] = [P2, P5].map(id => w.persons.find(p => p.personId === id)!) as [never, never]
    expect(resolveChildHouseAffiliation(w, f, mo, m)).toMatchObject({ status: 'RESOLVED', houseId: CARDON, basis: 'MATERNAL_CONTRACT_CLAUSE' })
    const foreign = { ...w, houses: w.houses.map(h => h.houseId === CARDON ? { ...h, countryId: 'country-margald' } : h) }
    expect(resolveChildHouseAffiliation(foreign, f, mo, m)).toEqual({ status: 'UNRESOLVED', reasonCode: 'CHILD_HOUSE_JURISDICTION_MISMATCH' })
    const twice = appended(w, { ...houseClause(w), clauseId: 'second' })
    expect(resolveChildHouseAffiliation(twice, f, mo, twice.legal.marriages[0]!)).toEqual({ status: 'UNRESOLVED', reasonCode: 'AMBIGUOUS_CHILD_HOUSE_CLAUSES' })
    expect(validateWorldState(twice).diagnostics.map(i => i.code)).toContain('MARRIAGE_CLAUSE_CONFLICT')
    const noEvidence = { ...m, contract: { ...m.contract!, evidenceId: '' } }
    expect(resolveChildHouseAffiliation(w, f, mo, noEvidence)).toEqual({ status: 'UNRESOLVED', reasonCode: 'MARRIAGE_CONTRACT_EVIDENCE_MISSING' })
    const unknown = { ...w, houses: w.houses.filter(h => h.houseId !== CARDON) }
    expect(childHouseClauseIssue(unknown, [f, mo], houseClause(w))).toBe('CHILD_HOUSE_UNKNOWN')
  })

  it('保存・復元後の後続出生も、復元した合意記録で同じ母方家門を用いる', () => {
    const restore = (w: WorldState) => {
      const parsed = validateWorldState(JSON.parse(JSON.stringify(w)))
      expect(parsed.diagnostics).toEqual([])
      return parsed.world!
    }
    const born = done(step(restore(maternalYear().world), [[P2, P5]], TRADE))
    expect(childOf(born.world, P2, P5).map(p => p.houseId)).toEqual([CARDON])
    const later = done(step(restore(born.world), [[P2, P5]], TRADE))
    expect(childOf(later.world, P2, P5).map(p => p.houseId)).toEqual([CARDON, CARDON])
    expect(claimedSlotGroups(later)).toEqual(['group-east-elite'])
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
    // 出生方式のみ（交渉設定そのものが無い）も拒否する。
    expect(createAutonomousCalibrationEvaluators({ ...base, childHouseAffiliation: 'DEC190_PATERNAL_PRINCIPLE' }))
      .toEqual({ ok: false, issues: ['CHILD_HOUSE_MODE_MISMATCH'] })
    expect(createAutonomousCalibrationEvaluators({ ...base, nextgenMarriage: { book: trial.book, laws: trial.laws,
      calibration: { ...DYNASTY, childHouse: V4_HOUSE } }, childHouseAffiliation: 'DEC190_PATERNAL_PRINCIPLE' }).ok).toBe(true)
    // 旧構成（どちらも無し・交渉設定のみ旧版）は従来どおり作れる。
    expect(createAutonomousCalibrationEvaluators(base).ok).toBe(true)
    expect(createAutonomousCalibrationEvaluators({ ...base, nextgenMarriage: { book: trial.book, laws: trial.laws, calibration: DYNASTY } }).ok).toBe(true)
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
    // reducer境界の単体検査。成功の証明ではなく、記録と結合した契約か否かで出生の可否が分かれることだけを見る。
    const agreement: ChildHouseAgreementRecord = { registeredYear: 1250, personIds: [P2, P5], sourceTraceId: 't-25',
      contractKey: 'NO_CLAUSE+CHILD_HOUSE:' + CARDON, firstConsentScore: 20, secondConsentScore: 20, consentThreshold: 15 }
    const contract = nextgenMarriageContract(1250, [P2, P5], agreement.contractKey, null,
      { houseId: CARDON, sourcePersonId: P5, agreement }, 't-25')
    const marriage: Marriage = { marriageId: 'm-25', personIds: [P2, P5], registeredYear: 1250, status: 'ACTIVE', contract }
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
    const forged: WorldState = { ...w, legal: { ...w.legal, marriages: [{ ...marriage,
      contract: { ...contract, contractId: 'c-25' } }] } }
    expect(rejectionCodes(run(forged, outcome('B-002', 3, [birth(child(CARDON))])))).toContain('LEGAL_BASIS_MISSING')
  })

  it('reducer: 登録時の合意記録と結合しない家門条項の婚姻は登録しない', () => {
    const y = done(step(createExperimentalWorld(), [[P2, P5]], { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE }))
    const legit = y.world.legal.marriages[0]!
    const base = newWorld()
    const register = (m: Marriage) => run(base, outcome('A-LEG-01', 3, [{ type: 'MARRIAGE_REGISTER', commandId: 'cmd-reg',
      source: { requestId: 'req-reg', year: 1250, phase: 3, sourceRuleId: 'A-LEG-01', sourceTraceId: 'trace-reg', sourceIntentId: 'intent-reg' },
      marriage: m }]))
    expect(register(legit).world.legal.marriages).toHaveLength(1)
    const clauses = legit.contract!.clauses.map(c => c.kind === 'CHILD_HOUSE_AFFILIATION' ? { ...c, clauseId: 'tampered' } : c)
    const bad = register({ ...legit, contract: { ...legit.contract!, clauses } })
    expect(rejectionCodes(bad)).toContain('LEGAL_BASIS_MISSING')
    expect(bad.world.legal.marriages).toHaveLength(0)
  })
})

describe('DEC-190 保存・parse・版付き構成', () => {
  it('家門条項はparseで往復し、旧JSONの王朝条項は不変。未知フィールド・王朝IDの混入は拒否', () => {
    const w = done(step(createExperimentalWorld(), [[P2, P5]], { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE })).world
    const parsed = validateWorldState(JSON.parse(JSON.stringify(w)))
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.world).toEqual(w)
    const bad = JSON.parse(JSON.stringify(w))
    bad.legal.marriages[0].contract.clauses[1].dynastyId = NALVEN_DYNASTY_ID
    expect(validateWorldState(bad).diagnostics.map(i => i.code)).toContain('UNKNOWN_FIELD')
    const missing = JSON.parse(JSON.stringify(w))
    delete missing.legal.marriages[0].contract.clauses[1].sourcePersonId
    expect(validateWorldState(missing).diagnostics.map(i => i.code)).toContain('MISSING_FIELD')
    const noAgreement = JSON.parse(JSON.stringify(w))
    delete noAgreement.legal.marriages[0].contract.clauses[1].agreement
    expect(validateWorldState(noAgreement).diagnostics.map(i => i.code)).toContain('MISSING_FIELD')
    const extra = JSON.parse(JSON.stringify(w))
    extra.legal.marriages[0].contract.clauses[1].agreement.signedBy = P5
    expect(validateWorldState(extra).diagnostics.map(i => i.code)).toContain('UNKNOWN_FIELD')
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
