// Issue #200 / DEC-189・MVP§8.5: 記録済みの近い共通祖先へ遡る傍系探索。人物・法令はすべて試験用（CALIBRATION_ONLY）。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import { createExperimentalOrdinaryLegalTrial } from '../../../src/scenario/experimental/ordinary-legal-trial.ts'
import type { Person, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import {
  ANCESTRAL_HEIR_SEARCH_VERSION, createASuc04WorldStateEvaluator, createATit07EvidenceEvaluator,
  createReviewedLegalEvaluators, reviewAncestralHeir, reviewLandHeir,
} from '../../../src/simulation/rules/a/index.ts'
import type { HeirSearchMode } from '../../../src/simulation/rules/a/index.ts'
import { createCrownSuccessionEvaluators } from '../../../src/simulation/rules/a/crown-succession.ts'
import { createB003CalibrationEvaluator } from '../../../src/simulation/rules/b/index.ts'

const base = createExperimentalWorld()
const template = base.persons[0]!
type Opt = Partial<Pick<Person, 'fatherId' | 'motherId' | 'alive' | 'legalDynasty'>>
const person = (personId: string, sex: Person['sex'], birthYear: number, o: Opt = {}): Person => {
  const { fatherId: _f, motherId: _m, ...rest } = template
  void [_f, _m]
  return {
    ...rest, personId, name: personId, sex, birthYear,
    alive: o.alive ?? false, ...(o.alive ? {} : { deathYear: 1285 }),
    legalDynasty: o.legalDynasty ?? { status: 'DETERMINED', dynastyId: 'dynasty-nalven' },
    ...(o.fatherId ? { fatherId: o.fatherId } : {}), ...(o.motherId ? { motherId: o.motherId } : {}),
  }
}
const world = (persons: readonly Person[]): WorldState => ({ ...base, year: 1286, persons: [...persons] })
const undetermined = { status: 'UNDETERMINED' as const, reasonCodes: ['TEST'] }

// 共通の家系: GGF→(GF, GU)。GF→(F)。F+M→PRE。M側: MGF→(M, MU)。
const GGF = person('ggf', 'MALE', 1150)
const GF = person('gf', 'MALE', 1180, { fatherId: 'ggf' })
const GU = person('gu', 'MALE', 1185, { fatherId: 'ggf' })
const MGF = person('mgf', 'MALE', 1178)
const F = person('f', 'MALE', 1210, { fatherId: 'gf' })
const M = person('m', 'FEMALE', 1215, { fatherId: 'mgf' })
const PRE = person('pre', 'MALE', 1240, { fatherId: 'f', motherId: 'm' })
const family = [GGF, GF, GU, MGF, F, M, PRE]
const review = (persons: readonly Person[]) => reviewAncestralHeir(world(persons), 'pre')

describe('DEC-189: 記録済みの近い共通祖先へ遡る傍系探索（純粋照合）', () => {
  it('直系・同胞枝の既存順位を維持し、旧照合と同じ後継を選ぶ', () => {
    const son = person('son', 'MALE', 1262, { fatherId: 'pre', alive: true })
    const dau = person('dau', 'FEMALE', 1260, { fatherId: 'pre', alive: true })
    const sib = person('sib', 'MALE', 1242, { fatherId: 'f', alive: true })
    for (const persons of [[...family, son, dau, sib], [...family, dau, sib], [...family, sib]]) {
      const old = reviewLandHeir(world(persons), 'pre')
      const next = review(persons)
      expect(next).toMatchObject({ status: old.status, rankedCandidateIds: old.rankedCandidateIds })
      if (old.status === 'READY') expect(next).toMatchObject({ personId: old.personId, relation: old.relation })
    }
    expect(review([...family, son, dau, sib])).toMatchObject({ status: 'READY', personId: 'son', search: { decisiveDepth: 0 } })
    expect(review([...family, sib])).toMatchObject({ status: 'READY', personId: 'sib', relation: 'COLLATERAL', search: { decisiveDepth: 1 } })
  })

  it('死亡した上位枝は代襲を先に審査し、異母・異父の同胞も同胞枝に含める', () => {
    const deadSon = person('dead-son', 'MALE', 1260, { fatherId: 'pre' })
    const grandson = person('grandson', 'MALE', 1280, { fatherId: 'dead-son', alive: true })
    const daughter = person('daughter', 'FEMALE', 1258, { fatherId: 'pre', alive: true })
    expect(review([...family, deadSon, grandson, daughter])).toMatchObject({ status: 'READY', personId: 'grandson', relation: 'DESCENDANT' })
    const maternalHalf = person('half', 'FEMALE', 1238, { fatherId: 'other-father', motherId: 'm', alive: true })
    expect(review([...family, maternalHalf])).toMatchObject({ status: 'READY', personId: 'half', search: { decisiveDepth: 1 } })
  })

  it('同胞枝が尽きた後、祖父母段階の叔父叔母・従兄弟を父母双方から順位付けて探す', () => {
    const uncle = person('uncle', 'MALE', 1212, { fatherId: 'gf' })
    const cousinF = person('cousin-f', 'FEMALE', 1238, { fatherId: 'uncle', alive: true })
    const maternalUncle = person('m-uncle', 'MALE', 1217, { fatherId: 'mgf' })
    const cousinM = person('cousin-m', 'MALE', 1245, { fatherId: 'm-uncle', alive: true })
    const persons = [...family, uncle, cousinF, maternalUncle, cousinM]
    expect(reviewLandHeir(world(persons), 'pre')).toMatchObject({ status: 'PENDING', reasonCodes: ['NO_ESTABLISHED_HEIR'] })
    const r = review(persons)
    // 祖父母段階の子は男子優先・年長: uncle(1212) → m-uncle(1217)。uncleの枝の代襲で娘が先に確立する。
    expect(r).toMatchObject({ status: 'READY', personId: 'cousin-f', relation: 'COLLATERAL' })
    expect(r.search.decisiveDepth).toBe(2)
    expect(r.search.steps.find(s => s.depth === 2)?.commonAncestorIds).toEqual(['gf', 'mgf'])
    expect(r.search.excluded).toEqual(expect.arrayContaining([
      { personId: 'f', depth: 2, reason: 'ANCESTOR_OF_PREDECESSOR' },
      { personId: 'm', depth: 2, reason: 'ANCESTOR_OF_PREDECESSOR' },
    ]))
    expect(r.search.version).toBe(ANCESTRAL_HEIR_SEARCH_VERSION)
    expect(r.rankedCandidateIds).toEqual(['uncle', 'cousin-f'])
  })

  it('近い段階に候補がいなければ曾祖父母段階の遠い枝へ進み、存命の祖先自身は候補にしない', () => {
    const livingGf = { ...GF, alive: true }
    delete (livingGf as { deathYear?: number }).deathYear
    const second = person('second-cousin', 'MALE', 1236, { fatherId: 'gu-son', alive: true })
    const guSon = person('gu-son', 'MALE', 1210, { fatherId: 'gu' })
    const r = review([GGF, livingGf, GU, MGF, F, M, PRE, guSon, second])
    expect(r).toMatchObject({ status: 'READY', personId: 'second-cousin', relation: 'COLLATERAL' })
    expect(r.search.decisiveDepth).toBe(3)
    expect(r.rankedCandidateIds).not.toContain('gf')
    expect(r.search.excluded).toContainEqual({ personId: 'gf', depth: 3, reason: 'ANCESTOR_OF_PREDECESSOR' })
  })

  it('同順位（同性・同生年）の枝はID順で選ばずPENDING', () => {
    const a = person('uncle-a', 'MALE', 1212, { fatherId: 'gf', alive: true })
    const b = person('uncle-b', 'MALE', 1212, { fatherId: 'mgf', alive: true })
    expect(review([...family, a, b])).toMatchObject({ status: 'PENDING', reasonCodes: ['SAME_PRIORITY_BIRTH_YEAR'], search: { decisiveDepth: 2 } })
  })

  it('上位候補の法的王朝所属が未確定なら下位候補へ飛ばさず保留し、王朝所属だけで順位を変えない', () => {
    const top = person('uncle', 'MALE', 1212, { fatherId: 'gf', alive: true, legalDynasty: undetermined })
    const lower = person('aunt', 'FEMALE', 1214, { fatherId: 'gf', alive: true })
    expect(review([...family, top, lower])).toMatchObject({
      status: 'PENDING', reasonCodes: ['LEGAL_DYNASTY_UNDETERMINED'], rankedCandidateIds: ['uncle'],
    })
    const otherDynasty = person('uncle', 'MALE', 1212, { fatherId: 'gf', alive: true,
      legalDynasty: { status: 'DETERMINED', dynastyId: 'dynasty-vargas' } })
    expect(review([...family, otherDynasty, lower])).toMatchObject({ status: 'READY', personId: 'uncle' })
  })

  it('複数経路で現れる同一人物は一人として扱い、真の循環とは区別する', () => {
    // 従兄弟婚: cousinはuncle(父方)とm-aunt(母方)の子。両方の枝から到達するが重複候補にしない。
    const uncle = person('uncle', 'MALE', 1212, { fatherId: 'gf' })
    const aunt = person('m-aunt', 'FEMALE', 1218, { fatherId: 'mgf' })
    const cousin = person('cousin', 'MALE', 1240, { fatherId: 'uncle', motherId: 'm-aunt', alive: true })
    const r = review([...family, uncle, aunt, cousin])
    expect(r).toMatchObject({ status: 'READY', personId: 'cousin' })
    expect(r.rankedCandidateIds.filter(id => id === 'cousin')).toHaveLength(1)
    // 代襲の経路上の人物が自分の子孫に再出現する記録は循環として保留する。
    const loopA = person('loop-a', 'MALE', 1212, { fatherId: 'gf', motherId: 'loop-b' })
    const loopB = person('loop-b', 'FEMALE', 1213, { fatherId: 'loop-a' })
    expect(review([...family, loopA, loopB])).toMatchObject({ status: 'PENDING', reasonCodes: ['KINSHIP_CYCLE'] })
    const selfAncestor = { ...GGF, fatherId: 'pre' }
    expect(review([selfAncestor, GF, GU, MGF, F, M, PRE])).toMatchObject({ status: 'PENDING', reasonCodes: ['KINSHIP_CYCLE'] })
  })

  it('記録された祖先が尽きれば候補ゼロ、祖先記録の欠落・親子不明は別理由で保留する', () => {
    expect(review(family)).toMatchObject({ status: 'PENDING', reasonCodes: ['NO_ESTABLISHED_HEIR', 'RECORDED_ANCESTRY_EXHAUSTED'], rankedCandidateIds: ['gu'] })
    expect(review([PRE, person('f', 'MALE', 1210), person('m', 'FEMALE', 1215)])).toMatchObject({ reasonCodes: ['NO_ESTABLISHED_HEIR', 'RECORDED_ANCESTRY_EXHAUSTED'], rankedCandidateIds: [] })
    const orphan = person('pre', 'MALE', 1240)
    expect(review([orphan])).toMatchObject({ status: 'PENDING', reasonCodes: ['COLLATERAL_PARENTAGE_UNDETERMINED'] })
    // 父の記録がない（参照のみ）場合、その先の祖父母段階は不明。同胞の照合は可能。
    expect(review([M, MGF, PRE])).toMatchObject({ status: 'PENDING', reasonCodes: ['ANCESTOR_RECORD_MISSING'] })
    const sib = person('sib', 'FEMALE', 1243, { fatherId: 'f', alive: true })
    expect(review([M, MGF, PRE, sib])).toMatchObject({ status: 'READY', personId: 'sib' })
  })

  it('前保持者が存命なら審査せず、当年死亡した候補は代襲へ進む', () => {
    expect(reviewAncestralHeir(world([...family.slice(0, -1), { ...PRE, alive: true }]), 'pre'))
      .toMatchObject({ status: 'PENDING', reasonCodes: ['PREDECESSOR_NOT_DECEASED'] })
    const uncle = person('uncle', 'MALE', 1212, { fatherId: 'gf' })
    const cousin = person('cousin', 'MALE', 1240, { fatherId: 'uncle', alive: true })
    expect(review([...family, uncle, cousin]).search.reviewed).toEqual([
      { personId: 'uncle', depth: 2, outcome: 'DECEASED_REPRESENTATION' },
      { personId: 'cousin', depth: 2, outcome: 'SELECTED' },
    ])
  })
})

// 実評価器・通常年次経路。旧構成（heirSearch省略）と比較する。
const LAND = 'title-exp-central'
const CROWN = 'title-exp-crown-eldia'
const P1 = 'person-exp-01'
const cousinWorld = (cousin: Opt = {}): WorldState => {
  const grand = person('synthetic-gf', 'MALE', 1180)
  const father = person('synthetic-f', 'MALE', 1185, { fatherId: 'synthetic-gf' })
  const uncle = person('synthetic-uncle', 'MALE', 1188, { fatherId: 'synthetic-gf' })
  const cousinP = person('synthetic-cousin', 'MALE', 1212, { fatherId: 'synthetic-uncle', alive: true, ...cousin })
  return {
    ...base,
    persons: [...base.persons.map(p => p.personId === P1 ? { ...p, fatherId: 'synthetic-f' }
      : p.fatherId === P1 ? { ...p, alive: false, deathYear: 1249 } : p), grand, father, uncle, cousinP],
  }
}
const landPending = (w: WorldState): WorldState => ({
  ...w, year: 1286,
  persons: w.persons.map(p => p.personId === P1 ? { ...p, alive: false, deathYear: 1285 } : p),
  titles: w.titles.map(t => t.titleId === LAND ? { ...t, holder: { status: 'UNDETERMINED' as const } } : t),
  legal: { ...w.legal, cases: [{
    caseId: 'case:asuc04:auto:' + JSON.stringify([1285, LAND]), kind: 'SUCCESSION' as const, titleId: LAND,
    status: 'PENDING' as const, candidatePersonIds: [],
    reasonCodes: ['CALIBRATION_ONLY', 'PREDECESSOR_ID:' + P1, 'SOURCE_B003_EVENT:synthetic-death-1285'],
  }] },
})
const landYear = (w: WorldState, heirSearch?: HeirSearchMode) => {
  const trial = createExperimentalOrdinaryLegalTrial()
  const reviewed = createReviewedLegalEvaluators({ book: trial.book, ordinaryLaws: trial.laws, ...(heirSearch ? { heirSearch } : {}) })
  if (!reviewed.ok) throw new Error(reviewed.issues.join(','))
  const r = runYear(w, { seed: 1, branchId: 'A0', evaluators: reviewed.evaluators })
  if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r.halt))
  return r
}
const crownYear = (w: WorldState, heirSearch?: HeirSearchMode) => {
  const trial = createExperimentalOrdinaryLegalTrial()
  const crown = createCrownSuccessionEvaluators(createASuc04WorldStateEvaluator(), createATit07EvidenceEvaluator(),
    { book: trial.book, laws: trial.laws, ...(heirSearch ? { heirSearch } : {}) })
  const death = createB003CalibrationEvaluator([{ evidenceId: 'synthetic-royal-death-1285', personId: P1, deathYear: 1285, provenance: 'CALIBRATION_ONLY' }])
  if (!death.ok) throw new Error('INVALID_SYNTHETIC_DEATH')
  const start: WorldState = { ...w, year: 1285, demographics: { ...w.demographics, cohortSlots: [{
    groupId: 'group-central-elite', year: 1285, birthSlots: 0, deathSlots: 1, claimedBirths: 0, claimedDeaths: 0 }] } }
  const r = runYear(start, { seed: 1, branchId: 'A0', evaluators: { 'A-SUC-04': crown.succession, 'A-TIT-07': crown.titleTransfer, 'B-003': death.evaluator } })
  if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r.halt))
  return r
}
const holder = (w: WorldState, id: string) => w.titles.find(t => t.titleId === id)!.holder

describe('DEC-189: 実A評価器の土地・CROWN審査（新旧構成の比較）', () => {
  it('土地: 旧構成は同胞枝で尽きて保留、DEC-189構成は既存法令の審査を経て従兄弟へ移転', () => {
    const w = landPending(cousinWorld())
    const old = landYear(w)
    expect(holder(old.world, LAND).status).toBe('UNDETERMINED')
    expect(old.traces.find(t => t.ruleId === 'A-SUC-04' && t.reasonCodes.includes('DEC_055_PENDING_REVIEW'))?.reasonCodes).toContain('NO_ESTABLISHED_HEIR')
    const next = landYear(w, 'RECORDED_COMMON_ANCESTOR')
    const review = next.traces.find(t => t.ruleId === 'A-SUC-04' && t.reasonCodes.includes('DEC_055_PENDING_REVIEW'))!
    expect(review.status).toBe('ACCEPT')
    expect(review.candidates[0]!.inputs).toMatchObject({
      candidatePersonId: 'synthetic-cousin', heirRelation: 'COLLATERAL', heirReviewStatus: 'READY',
      rankedCandidateIds: ['person-exp-02', 'person-exp-03', 'synthetic-uncle', 'synthetic-cousin'],
      heirSearch: { version: ANCESTRAL_HEIR_SEARCH_VERSION, decisiveDepth: 2 },
    })
    expect(next.world.legal.cases[0]).toMatchObject({ status: 'APPROVED', candidatePersonIds: ['synthetic-cousin'] })
    // 同年のA-TIT-07が同じ照合器で再審査して移転。新委任は独立の委任審査（承認またはDEFER）を経る。
    expect(holder(next.world, LAND)).toEqual({ status: 'HELD', personId: 'synthetic-cousin' })
    const transfer = next.events.find(e => e.eventType === 'LEGAL_TITLE_TRANSFER')!
    expect(next.traces.some(t => t.ruleId === 'A-TIT-07' && t.eventIds.includes(transfer.eventId) &&
      t.reasonCodes.includes('REVIEWED_SUCCESSION_TITLE_TRANSFER'))).toBe(true)
    expect(next.traces.some(t => t.ruleId === 'A-TIT-07' && (t.reasonCodes.includes('EXPLICIT_NEW_MANDATE_EVIDENCE') ||
      t.reasonCodes.includes('GAME_03_NEW_DELEGATION_EVIDENCE_MISSING')))).toBe(true)
    expect(next.world.regions).toEqual(w.regions)
    expect(landYear(w, 'RECORDED_COMMON_ANCESTOR')).toEqual(next) // 同条件の再計算完全一致
  })

  it('土地: 上位の従兄弟の法的王朝所属が未確定なら新構成でもDEFERし、移転しない', () => {
    const w = landPending(cousinWorld({ legalDynasty: undetermined }))
    const r = landYear(w, 'RECORDED_COMMON_ANCESTOR')
    const review = r.traces.find(t => t.ruleId === 'A-SUC-04' && t.reasonCodes.includes('DEC_055_PENDING_REVIEW'))!
    expect(review.status).toBe('DEFER')
    expect(review.reasonCodes).toContain('LEGAL_DYNASTY_UNDETERMINED')
    expect(review.candidates[0]!.inputs).toMatchObject({ candidatePersonId: null, heirReviewStatus: 'PENDING' })
    expect(r.world.legal.cases[0]?.status).toBe('PENDING')
    expect(holder(r.world, LAND).status).toBe('UNDETERMINED')
  })

  it('CROWN: 実死亡Eventと王位法令で、旧構成はUNDETERMINED、DEC-189構成は従兄弟を承認して国家統治者も更新', () => {
    const w = cousinWorld()
    const old = crownYear(w)
    expect(holder(old.world, CROWN).status).toBe('UNDETERMINED')
    const next = crownYear(w, 'RECORDED_COMMON_ANCESTOR')
    expect(holder(next.world, CROWN)).toEqual({ status: 'HELD', personId: 'synthetic-cousin' })
    expect(next.world.countries.find(c => c.countryId === 'country-eldia')?.rulerPersonId).toBe('synthetic-cousin')
    const review = next.traces.find(t => t.reasonCodes.includes('CROWN_SUCCESSION_REVIEW'))!
    expect(review.candidates[0]!.inputs).toMatchObject({ heirRelation: 'COLLATERAL', heirSearch: { decisiveDepth: 2 } })
    // 王位単独では土地Titleを移さない（土地は別審査）。
    expect(holder(next.world, LAND)).toEqual(holder(old.world, LAND))
  })

  it('CROWN: 王位法令がなければ新構成でも承認せず、同一王朝の従兄弟がいても保留', () => {
    const w = cousinWorld()
    const trial = createExperimentalOrdinaryLegalTrial()
    const crown = createCrownSuccessionEvaluators(createASuc04WorldStateEvaluator(), createATit07EvidenceEvaluator(),
      { book: trial.book, laws: trial.laws.filter(l => !JSON.stringify(l).includes('CROWN_SUCCESSION')), heirSearch: 'RECORDED_COMMON_ANCESTOR' })
    const death = createB003CalibrationEvaluator([{ evidenceId: 'synthetic-royal-death-1285', personId: P1, deathYear: 1285, provenance: 'CALIBRATION_ONLY' }])
    if (!death.ok) throw new Error('INVALID_SYNTHETIC_DEATH')
    const start: WorldState = { ...w, year: 1285, demographics: { ...w.demographics, cohortSlots: [{
      groupId: 'group-central-elite', year: 1285, birthSlots: 0, deathSlots: 1, claimedBirths: 0, claimedDeaths: 0 }] } }
    const r = runYear(start, { seed: 1, branchId: 'A0', evaluators: { 'A-SUC-04': crown.succession, 'A-TIT-07': crown.titleTransfer, 'B-003': death.evaluator } })
    if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r.halt))
    expect(holder(r.world, CROWN).status).toBe('UNDETERMINED')
    const review = r.traces.find(t => t.reasonCodes.includes('CROWN_SUCCESSION_REVIEW'))!
    expect(review.reasonCodes).toContain('CROWN_LAW_OR_AUTHORITY_MISSING')
    expect(review.candidates[0]!.inputs).toMatchObject({ candidatePersonId: 'synthetic-cousin', heirReviewStatus: 'READY' })
  })

  it('不正な探索モードは構成時に拒否する', () => {
    const trial = createExperimentalOrdinaryLegalTrial()
    expect(createReviewedLegalEvaluators({ book: trial.book, ordinaryLaws: trial.laws,
      heirSearch: 'ANY' as HeirSearchMode })).toEqual({ ok: false, issues: ['INVALID_HEIR_SEARCH_MODE'] })
  })
})

describe('DEC-189: 独立した版付きexperimental構成', () => {
  it('既存v2/限定試遊のdigestを変えず、新構成は探索範囲と版だけが異なる', async () => {
    const x = await import('../../../src/scenario/experimental/index.ts')
    expect(x.multiHouseDemandRunConfigDigest(0)).toBe('844299b001142fee')
    expect(x.multiHouseDemandRunConfigDigest(1)).toBe('d8260d46ed460630')
    const oldId = x.multiHouseDemandRunConfigIdentity(0) as Record<string, unknown>
    const newId = x.multiHouseAncestralRunConfigIdentity(0) as Record<string, unknown>
    expect(new Set([x.multiHouseAncestralRunConfigDigest(0), x.multiHouseAncestralRunConfigDigest(1), x.multiHouseDemandRunConfigDigest(0)]).size).toBe(3)
    expect(newId.configId).toBe('experimental-multi-house-v3-dec189-ancestral-heirs-drift-0')
    const changed = Object.keys(newId).filter(k => JSON.stringify(newId[k]) !== JSON.stringify(oldId[k])).sort()
    expect(changed).toEqual(['configId', 'heirSearch', 'ruleVersions'])
    expect(newId.ruleVersions).toEqual({ ...oldId.ruleVersions as object, heirSearch: ANCESTRAL_HEIR_SEARCH_VERSION })
    expect(newId.world).toEqual(x.createMultiHouseDemandWorld(0))
  })
})
