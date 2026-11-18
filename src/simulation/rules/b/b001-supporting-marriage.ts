// DEC-061 / Issue #83: PopulationGroupの少数の匿名候補をB-001でSUPPORTINGとして記録。
// 成立した婚姻・近親適格性・合法王朝帰属を推定せず、CALIBRATION_ONLYの候補供給のみ行う。
import type { DecisionTraceDraft, Id, Person, PersonSupportingRecordCommand, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { proposeSupportingMarriageCandidates, validateSupportingMarriageCohorts } from '../../population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../population/supporting-marriage.ts'
import { validateSupportingKinshipClearances } from '../../legal/supporting-kinship-clearance.ts'
import type { SupportingKinshipClearance } from '../../legal/supporting-kinship-clearance.ts'

export const B001_SUPPORTING_VERSION = 'b001-supporting-registration-0:CALIBRATION_ONLY'
export type B001SupportingInput = Readonly<{
  cohorts: readonly SupportingMarriageCohort[]
  /** 1年の新規記録上限。全人口のPerson化をしない。 */
  maxRecordsPerYear: number
  /** 記録済みの生存補助人物がこの値以上なら新たに抽出しない。 */
  maxAliveSupporting: number
  perCohortSamples: number
  maximumPreviewAge: number
  /**
   * 任意。指定時は、人物ペア単位の禁親確認証拠(B-005/A-LEG-01が使う台帳と同じ入力。照合条件も同じ: 管轄一致・当年有効・ちょうど1件)が当年有効な
   * 候補だけを個別化する。証拠の無い候補を記録して予算・生存枠を使い切ること(候補枯渇)を避けるだけで、
   * 禁親審査そのものは緩和しない(審査はB-005/A-LEG-01が従来どおり再実施)。未指定は従来動作。
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
      throw new EvaluationFailure('B-001補助人物記録は当年フェーズ3に限ります',[
        {code:'RULE_MISMATCH',message:String(ctx.ruleId)}])
    }
    // まだ18歳に達していないC004コホートは、現在の年に出生/成人したことにしない。
    const eligibleCohorts=cohorts.filter(c=>ctx.year-c.birthYear>=18&&
      ctx.year-c.birthYear<=settings.maximumPreviewAge)
    const checked = validateSupportingMarriageCohorts(world, eligibleCohorts)
    if (checked.length > 0) throw new EvaluationFailure('人口集団の補助人物出典が不整合',
      checked.map(code => ({code,message:code})))
    const active = world.persons.filter(p => p.alive && p.interactionRole === 'SUPPORTING').length
    const used = new Set<Id>(world.persons.map(p => p.personId))
    const married = new Set(world.legal.marriages.filter(m => m.status === 'ACTIVE').flatMap(m => m.personIds))
    const seekers = world.persons
      .filter(p => p.alive && p.interactionRole !== 'SUPPORTING' &&
        !married.has(p.personId) && ctx.year - p.birthYear >= 18)
      .sort((a,b) => cmp(a.personId,b.personId))
    const traceDrafts: DecisionTraceDraft[] = []
    const commands: PersonSupportingRecordCommand[] = []
    const defer=(seekerId:Id, reasonCode:string)=>{
      const key=JSON.stringify([ctx.year,seekerId,reasonCode])
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'PERSON',id:seekerId},
        candidates:[{candidateId:'b001:supporting:defer:'+key,eligible:false,
          inputs:{seekerPersonId:seekerId,provenance:'CALIBRATION_ONLY'},
          reasonCodes:['CALIBRATION_ONLY',reasonCode]}],
        status:'DEFER',reasonCodes:['CALIBRATION_ONLY','SUPPORTING_SUPPLY_DEFERRED',reasonCode],
        modifierIds:[],ruleVersion:B001_SUPPORTING_VERSION,
      })
    }
    for (const seeker of seekers) {
      const seekerCountry = world.houses.find(h => h.houseId === seeker.houseId)?.countryId
      if (commands.length >= settings.maxRecordsPerYear ||
          active + commands.length >= settings.maxAliveSupporting){
        defer(seeker.personId,'SUPPORTING_RECORD_BUDGET_EXCEEDED')
        break
      }
      if (evidenceBacked && settings.maxOpenCandidatesPerSeeker !== undefined) {
        const open = world.persons.filter(p => p.alive && p.interactionRole === 'SUPPORTING' &&
          !married.has(p.personId) && p.sex !== seeker.sex && selected(seeker.personId, p.personId) && cleared(seeker.personId, p.personId, ctx.year, seekerCountry)).length
        if (open >= settings.maxOpenCandidatesPerSeeker) {
          defer(seeker.personId, 'OPEN_EVIDENCE_BACKED_CANDIDATES_AT_LIMIT')
          continue
        }
      }
      const supplied = proposeSupportingMarriageCandidates(world, seeker.personId, eligibleCohorts, {
        ...((evidenceBacked || candidatePairs !== undefined) ? { candidateFilter: (c: { candidateId: Id }) => selected(seeker.personId, c.candidateId) && (!evidenceBacked || cleared(seeker.personId, c.candidateId, ctx.year, seekerCountry)) } : {}),
        seed: ctx.seed,
        maxCandidates: 1,
        perCohortSamples: settings.perCohortSamples,
        maximumPreviewAge: settings.maximumPreviewAge,
        usedCandidateIds: used,
      })
      if (supplied.status !== 'PROPOSED') {
        defer(seeker.personId,supplied.reasonCodes[0]??'NO_COHORT_CANDIDATE_AVAILABLE')
        continue
      }
      const candidate = supplied.candidates[0]!
      const cohort = cohorts.find(c => c.cohortId === candidate.cohortId)!
      // 候補IDは年・枝に依存しない。重複した個別化はWorldStateと使用済みIDで拒否する。
      used.add(candidate.candidateId)
      const person: Person = {
        personId: candidate.candidateId,
        name: '試験用補助人物 ' + candidate.cohortId + ' #' + candidate.ordinal,
        interactionRole: 'SUPPORTING',
        sex: candidate.sex, birthYear: candidate.birthYear, alive: true,
        originGroupId: candidate.groupId, houseId: candidate.affiliationHouseId,
        legalDynasty: { status: 'UNDETERMINED', reasonCodes: ['POPULATION_COHORT_NOT_A_DYNASTY_PROOF'] },
      }
      const key = JSON.stringify([ctx.year,candidate.candidateId])
      const traceIndex = traceDrafts.length
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: {kind:'GROUP',id:candidate.groupId},
        candidates: [{
          candidateId: 'b001:supporting:' + key, eligible: true,
          inputs: {
            seekerPersonId: seeker.personId, supportingPersonId: person.personId,
            cohortId: cohort.cohortId, familyPoolId: candidate.familyPoolId,
            memberOrdinal: candidate.ordinal, sourceEvidenceId: cohort.sourceEvidenceId,
            survivorAttestationId: cohort.survivorAttestationId??null,
            kinshipStatus: 'UNVERIFIED', provenance: 'CALIBRATION_ONLY',
          },
          reasonCodes: ['CALIBRATION_ONLY','SUPPORTING_RECORD_ONLY','NOT_MARRIAGE_APPROVAL'],
        }],
        selectedCandidateId: 'b001:supporting:' + key, status: 'ACCEPT',
        reasonCodes: ['CALIBRATION_ONLY','SUPPORTING_RECORD_ONLY','NOT_MARRIAGE_APPROVAL'],
        modifierIds: [], ruleVersion: B001_SUPPORTING_VERSION,
      })
      commands.push({
        type: 'PERSON_SUPPORTING_RECORD',
        commandId: 'cmd:b001:supporting:' + key,
        source: {
          requestId: 'req:b001:supporting:' + key,
          year: ctx.year, phase: ctx.phase, sourceRuleId: 'B-001',
          sourceTraceId: ctx.traceId(traceIndex),
          sourceIntentId: cohort.sourceEvidenceId,
        },
        person, cohortId: cohort.cohortId, cohortSize: cohort.memberCount,
        memberOrdinal: candidate.ordinal,
        familyPoolId: cohort.familyPoolId,
        sourceEvidenceId: cohort.sourceEvidenceId, birthBacking: cohort.source,
        ...(cohort.survivorAttestationId?{survivorAttestationId:cohort.survivorAttestationId}:{}),
      })
    }
    return {ruleId: ctx.ruleId, phase: ctx.phase, commands,requests:[],deferred:[],traceDrafts}
  }
  return {ok:true,evaluator}
}
