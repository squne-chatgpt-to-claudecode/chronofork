// DEC-061: 未成立の候補は抽象ビューに留め、個別Personを記録しない。
// 成立した婚姻・近親適格性・合法王朝帰属を推定せず、CALIBRATION_ONLYの候補供給のみ行う。
import type { DecisionTraceDraft, Id, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { createSupportingMarriageCandidateView, validateSupportingMarriageCohorts } from '../../population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../population/supporting-marriage.ts'
import { validateSupportingKinshipClearances } from '../../legal/supporting-kinship-clearance.ts'
import type { SupportingKinshipClearance } from '../../legal/supporting-kinship-clearance.ts'

export const B001_SUPPORTING_VERSION = 'b001-supporting-candidates-1:CALIBRATION_ONLY'
export type B001SupportingInput = Readonly<{
  cohorts: readonly SupportingMarriageCohort[]
  /** 1年の新規記録上限。全人口のPerson化をしない。 */
  maxRecordsPerYear: number
  /** 成立時に適用する、記録済み生存補助人物の上限。抽象候補数の上限ではない。 */
  maxAliveSupporting: number
  perCohortSamples: number
  maximumPreviewAge: number
  /**
   * 任意。指定時は、人物ペア単位の禁親確認証拠(B-005/A-LEG-01が使う台帳と同じ入力。照合条件も同じ: 管轄一致・当年有効・ちょうど1件)が当年有効な
   * 候補だけを提示する。禁親審査そのものは緩和しない(審査はB-005/A-LEG-01が再実施)。
   */
  kinshipClearances?: readonly SupportingKinshipClearance[]
  /** 個別化の探索対象だけを指定する。法的証拠ではなく審査結果を変更しない。 */
  candidatePairs?: readonly (readonly [Id, Id])[]
  /** 任意。kinshipClearances指定時に、1人の探索者へ同時に保持する証拠付き未婚候補の上限(1〜8)。 */
  maxOpenCandidatesPerSeeker?: number
}>
export type B001SupportingFactory =
  | Readonly<{ ok: true; evaluator: RuleEvaluator }>
  | Readonly<{ ok: false; issues: readonly string[] }>
const validNumber = (n: number, min: number, max: number) =>
  Number.isSafeInteger(n) && n >= min && n <= max
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export function createB001SupportingMarriageEvaluator(input: B001SupportingInput): B001SupportingFactory {
  if (!input || !Array.isArray(input.cohorts) ||
      !validNumber(input.maxRecordsPerYear, 1, 4) ||
      !validNumber(input.maxAliveSupporting, 1, 64) ||
      !validNumber(input.perCohortSamples, 1, 16) ||
      !validNumber(input.maximumPreviewAge, 18, 100) ||
      (input.maxOpenCandidatesPerSeeker !== undefined && !validNumber(input.maxOpenCandidatesPerSeeker, 1, 8)) ||
      (input.kinshipClearances !== undefined && validateSupportingKinshipClearances(input.kinshipClearances).length > 0) ||
      (input.candidatePairs !== undefined && (!Array.isArray(input.candidatePairs) || input.candidatePairs.some(p =>
        !Array.isArray(p) || p.length !== 2 || p.some(id => typeof id !== 'string' || !id)))))
    return {ok:false,issues:['INVALID_SUPPORTING_REGISTRATION_CALIBRATION']}
  const cohorts = structuredClone(input.cohorts) as SupportingMarriageCohort[]
  const settings = Object.freeze({
    maxRecordsPerYear: input.maxRecordsPerYear,
    maxAliveSupporting: input.maxAliveSupporting,
    perCohortSamples: input.perCohortSamples,
    maximumPreviewAge: input.maximumPreviewAge,
    maxOpenCandidatesPerSeeker: input.maxOpenCandidatesPerSeeker,
  })
  const clearanceByPair = new Map<string, SupportingKinshipClearance[]>()
  for (const c of structuredClone(input.kinshipClearances ?? []) as SupportingKinshipClearance[]) {
    const k = JSON.stringify(c.personIds)
    clearanceByPair.set(k, [...(clearanceByPair.get(k) ?? []), c])
  }
  const candidatePairs = input.candidatePairs === undefined ? undefined : new Set(input.candidatePairs.map(p => JSON.stringify(p)))
  const selected = (a: Id, b: Id) => candidatePairs === undefined || candidatePairs.has(JSON.stringify([a, b]))
  const evidenceBacked = input.kinshipClearances !== undefined
  // B-005/A-LEG-01(reviewSupportingKinshipClearance)と同じ厳しさ: 管轄一致・当年有効・ちょうど1件のときだけ。
  const cleared = (a: Id, b: Id, year: number, countryId: Id | undefined): boolean =>
    countryId !== undefined &&
    (clearanceByPair.get(JSON.stringify(cmp(a, b) <= 0 ? [a, b] : [b, a])) ?? [])
      .filter(c => c.countryId === countryId && c.checkedYear <= year && year < c.validUntilYear).length === 1
  const evaluator: RuleEvaluator = (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
    if (ctx.ruleId !== 'B-001' || ctx.phase !== 3 || ctx.year !== world.year) {
      throw new EvaluationFailure('B-001補助人物候補の供給は当年フェーズ3に限ります',[
        {code:'RULE_MISMATCH',message:String(ctx.ruleId)}])
    }
    // まだ18歳に達していないC004コホートは、現在の年に出生/成人したことにしない。
    const eligibleCohorts=cohorts.filter(c=>ctx.year-c.birthYear>=18&&
      ctx.year-c.birthYear<=settings.maximumPreviewAge)
    const checked = validateSupportingMarriageCohorts(world, eligibleCohorts)
    const evidenceMissing = new Set([
      'COHORT_SOURCE_EVIDENCE_MISSING', 'C004_SURVIVOR_ATTESTATION_MISSING',
      'C004_BIRTH_BACKING_INSUFFICIENT', 'C004_SHARED_BIRTH_CAPACITY_EXCEEDED',
    ])
    if (checked.some(code => !evidenceMissing.has(code.split(':', 1)[0]!))) {
      throw new EvaluationFailure('人口集団の補助人物出典が不整合', checked.map(code => ({code,message:code})))
    }
    const married = new Set(world.legal.marriages.filter(m => m.status === 'ACTIVE').flatMap(m => m.personIds))
    const seekers = world.persons
      .filter(p => p.alive && p.interactionRole !== 'SUPPORTING' &&
        !married.has(p.personId) && ctx.year - p.birthYear >= 18)
      .sort((a,b) => cmp(a.personId,b.personId))
    const traceDrafts: DecisionTraceDraft[] = []
    const defer=(seekerId:Id, ...reasonCodes:string[])=>{
      const key=JSON.stringify([ctx.year,seekerId,...reasonCodes])
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'PERSON',id:seekerId},
        candidates:[{candidateId:'b001:supporting:defer:'+key,eligible:false,
          inputs:{seekerPersonId:seekerId,provenance:'CALIBRATION_ONLY'},
          reasonCodes:['CALIBRATION_ONLY',...reasonCodes]}],
        status:'DEFER',reasonCodes:['CALIBRATION_ONLY','SUPPORTING_SUPPLY_DEFERRED',...reasonCodes],
        modifierIds:[],ruleVersion:B001_SUPPORTING_VERSION,
      })
    }
    for (const seeker of seekers) {
      // 共通の出生枠を再配分せず、供給台帳全体を保留する。登録済み人物の審査は続行できる。
      if (checked.length > 0) {
        defer(seeker.personId, ...checked)
        continue
      }
      const seekerCountry = world.houses.find(h => h.houseId === seeker.houseId)?.countryId
      let candidateBudget = 32
      if (evidenceBacked && settings.maxOpenCandidatesPerSeeker !== undefined) {
        const open = world.persons.filter(p => p.alive && p.interactionRole === 'SUPPORTING' &&
          !married.has(p.personId) && p.sex !== seeker.sex && selected(seeker.personId, p.personId) && cleared(seeker.personId, p.personId, ctx.year, seekerCountry)).length
        candidateBudget = settings.maxOpenCandidatesPerSeeker - open
        if (candidateBudget <= 0) {
          defer(seeker.personId, 'OPEN_EVIDENCE_BACKED_CANDIDATES_AT_LIMIT')
          continue
        }
      }
      const supplied = createSupportingMarriageCandidateView(world, {branchId:ctx.branchId, year:ctx.year, seekerId:seeker.personId}, eligibleCohorts, {
        ...((evidenceBacked || candidatePairs !== undefined) ? { candidateFilter: (c: { candidateId: Id }) => selected(seeker.personId, c.candidateId) && (!evidenceBacked || cleared(seeker.personId, c.candidateId, ctx.year, seekerCountry)) } : {}),
        seed: ctx.seed,
        maxCandidates: candidateBudget,
        perCohortSamples: settings.perCohortSamples,
        maximumPreviewAge: settings.maximumPreviewAge,
      }).result
      if (supplied.status !== 'PROPOSED') {
        defer(seeker.personId,supplied.reasonCodes[0]??'NO_COHORT_CANDIDATE_AVAILABLE')
        continue
      }
      for (const candidate of supplied.candidates) {
      const cohort = cohorts.find(c => c.cohortId === candidate.cohortId)!
      // 同じ抽象候補を複数探索者に提示できる。記録予算は成立時に検証する。
      const key = JSON.stringify([ctx.year,seeker.personId,candidate.candidateId])
      // このTraceのラベルは診断情報であり、枝・出典・存命の証明ではない。
      // 後続で使用する場合は当年のWorldStateと信頼できる入力から再導出・照合する必要がある。
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: {kind:'GROUP',id:candidate.groupId},
        candidates: [{
          candidateId: 'b001:supporting:' + key, eligible: true,
          inputs: {
            seekerPersonId: seeker.personId, supportingCandidateId: candidate.candidateId,
            cohortId: cohort.cohortId, cohortSize: cohort.memberCount, familyPoolId: candidate.familyPoolId,
            memberOrdinal: candidate.ordinal, sourceEvidenceId: cohort.sourceEvidenceId,
            survivorAttestationId: cohort.survivorAttestationId??null,
            candidateBranchId: ctx.branchId, candidateYear: ctx.year,
            candidateGroupId: candidate.groupId, candidateHouseId: candidate.affiliationHouseId,
            candidateSex: candidate.sex, candidateBirthYear: candidate.birthYear,
            candidateTier: candidate.tier, populationSource: cohort.source,
            kinshipStatus: 'UNVERIFIED', provenance: 'CALIBRATION_ONLY',
            maxRecordsPerYear: settings.maxRecordsPerYear, maxAliveSupporting: settings.maxAliveSupporting,
          },
          reasonCodes: ['CALIBRATION_ONLY','SUPPORTING_CANDIDATE_ONLY','NOT_MARRIAGE_APPROVAL'],
        }],
        selectedCandidateId: 'b001:supporting:' + key, status: 'ACCEPT',
        reasonCodes: ['CALIBRATION_ONLY','SUPPORTING_CANDIDATE_ONLY','NOT_MARRIAGE_APPROVAL'],
        modifierIds: [], ruleVersion: B001_SUPPORTING_VERSION,
      })
      }
    }
    return {ruleId: ctx.ruleId, phase: ctx.phase, commands:[],requests:[],deferred:[],traceDrafts}
  }
  return {ok:true,evaluator}
}
