// DEC-058: B-005双方合意の当年Traceを再検証し、DEC-057の法制権限を通してのみ婚姻を登録。
// 出生児の王朝所属はここで指定しない（A-DYN-02が唯一の明示契約条項から後年確定する）。
import type { SupportingPersonRegistration, WorldState } from '../../contracts/index.ts'
import { supportingPopulationEvidenceIds, inspectSupportingCandidateSupply } from '../../autonomy/supporting-candidate-view.ts'
import type { SupportingCandidateResolver } from '../../autonomy/supporting-candidate-view.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import type { LegalEvidenceBook } from '../../legal/evidence.ts'
import type { OrdinaryLaw } from '../../legal/ordinary-authority.ts'
import { reviewOrdinaryAuthority } from '../../legal/ordinary-authority.ts'
import { chooseNextgenContract, negotiatedMarriageContract,
  EXPERIMENTAL_NEXTGEN_CONTRACT, validateNextgenContractCalibration } from '../../legal/nextgen-contract.ts'
import type { NextgenContractCalibration } from '../../legal/nextgen-contract.ts'
import { reviewDomesticMarriageEligibility } from '../../legal/nextgen-marriage.ts'
import { reviewSupportingKinshipClearance,supportingClearanceKey,validateSupportingKinshipClearances }
  from '../../legal/supporting-kinship-clearance.ts'
import type { SupportingKinshipClearance } from '../../legal/supporting-kinship-clearance.ts'
export type { SupportingKinshipClearance } from '../../legal/supporting-kinship-clearance.ts'
import { pairKey } from '../../intervention/index.ts'
import { B004_CALIBRATION_REASON } from '../b/b004-candidate.ts'
import { createALeg01OrdinaryEvaluator } from './aleg01-ordinary.ts'
import type { OrdinaryMarriageReview } from './aleg01-ordinary.ts'

export type NextgenMarriageInput=Readonly<{
  book:LegalEvidenceBook
  laws:readonly OrdinaryLaw[]
  calibration?:NextgenContractCalibration
  /** SUPPORTINGと婚姻する場合だけ別個に必要な血縁照合証拠。省略は保留。 */
  supportingKinshipClearances?:readonly SupportingKinshipClearance[]
  supportingCandidateResolver?:SupportingCandidateResolver
}>
export type NextgenMarriageFactory=
  | Readonly<{ok:true;evaluator:RuleEvaluator}>
  | Readonly<{ok:false;issues:readonly string[]}>

const supportingEvidence = new WeakMap<RuleEvaluator, Readonly<{resolve: SupportingCandidateResolver; clearanceKey: string}>>()
export const aLeg01SupportingEvidence = (evaluator: RuleEvaluator | undefined) =>
  evaluator && supportingEvidence.get(evaluator)

export function createALeg01NextgenEvaluator(input:NextgenMarriageInput):NextgenMarriageFactory{
  const cal=structuredClone(input.calibration??EXPERIMENTAL_NEXTGEN_CONTRACT)
  const resolveSupporting=input.supportingCandidateResolver
  const issues=[...validateNextgenContractCalibration(cal)]
  const base=createALeg01OrdinaryEvaluator({book:input.book,laws:input.laws,reviews:[]})
  if(!base.ok)issues.push(...base.issues)
  const clearances=input.supportingKinshipClearances??[]
  issues.push(...validateSupportingKinshipClearances(clearances))
  if(issues.length>0)return {ok:false,issues}
  const stableClearances=structuredClone(clearances) as SupportingKinshipClearance[]
  const book=structuredClone(input.book) as LegalEvidenceBook
  const laws=structuredClone(input.laws) as OrdinaryLaw[]
  const evaluator:RuleEvaluator=(world:WorldState,ctx:EvaluationContext)=>{
    if(ctx.ruleId!=='A-LEG-01'||ctx.phase!==3||ctx.year!==world.year)
      throw new EvaluationFailure('A-LEG-01次世代婚姻の年/RuleID/Phase不一致',[
        {code:'RULE_MISMATCH',message:'A-LEG-01 Phase3'}])
    const reviews:OrdinaryMarriageReview[]=[]
    const registrations:SupportingPersonRegistration[]=[]
    const {candidates:resolved,rankingBlock}=inspectSupportingCandidateSupply(resolveSupporting,world,ctx)
    const candidates=[...book.marriageCandidates]
    for(const query of ctx.marriageQueries??[]){
      if(rankingBlock)continue
      const pair=query.payload.personIds
      const key=pairKey(pair)
      const matching=resolved.filter(c=>pair.includes(c.seekerId)&&pair.includes(c.person.personId))
      if(matching.length>1)continue
      const temporary=matching.map(c=>c.person)
      const eligibility=reviewDomesticMarriageEligibility(world,pair,temporary)
      if(eligibility.status!=='ELIGIBLE')continue
      // B-005とA-LEG-01は同じ当事者別証拠を再審査。違う証拠IDでのすり替えは認めない。
      const clearance=reviewSupportingKinshipClearance(
        world,pair,eligibility.countryId,ctx.year,stableClearances,temporary,supportingPopulationEvidenceIds(resolveSupporting))
      if(clearance.status!=='CLEARED')continue
      if(query.source.year!==ctx.year||query.source.phase!==3||query.source.sourceRuleId!=='B-005')continue
      const b5=(ctx.priorTraces??[]).filter(t=>t.traceId===query.source.sourceTraceId)
      if(b5.length!==1)continue
      const verified=b5[0]!
      if(verified.ruleId!=='B-005'||verified.year!==ctx.year||verified.phase!==3||verified.status!=='ACCEPT'||
        !verified.reasonCodes.includes('DEC_058_CONTRACT_NEGOTIATION')||
        verified.actorRef.kind!=='PERSON_PAIR'||pairKey(verified.actorRef.ids)!==key||
        verified.candidates.length!==1)continue
      const negotiation=verified.candidates[0]!
      if(!negotiation.eligible||verified.selectedCandidateId!==negotiation.candidateId||
        negotiation.inputs.sourceRequestId!==query.source.requestId)continue
      if((temporary.length>0||pair.some(id=>world.persons.find(p=>p.personId===id)?.interactionRole==='SUPPORTING'))&&
        negotiation.inputs.supportingKinshipClearanceId!==clearance.clearanceId)continue
      const priorId=negotiation.inputs.sourceB004TraceId
      if(query.source.sourceIntentId!==priorId)continue
      const b4=(ctx.priorTraces??[]).filter(t=>t.traceId===priorId)
      if(b4.length!==1)continue
      const source=b4[0]!
      if(source.ruleId!=='B-004'||source.status!=='ACCEPT'||source.year!==ctx.year||source.phase!==3||
        !source.reasonCodes.includes(B004_CALIBRATION_REASON)||source.actorRef.kind!=='PERSON_PAIR'||
        pairKey(source.actorRef.ids)!==key||source.candidates.length!==1)continue
      const candidate=source.candidates[0]!
      const score=candidate.score
      if(!candidate.eligible||source.selectedCandidateId!==candidate.candidateId||
        typeof score!=='number'||!Number.isSafeInteger(score)||negotiation.inputs.sourceB004Score!==score)continue
      // 双方の効用は当事者順に記録されるため、B-005と同じ順序で再計算する。
      const agreement=chooseNextgenContract(world,verified.actorRef.ids,score,cal,temporary)
      if(agreement.status!=='ACCEPT'||negotiation.inputs.selectedContractKey!==agreement.choice.key)continue
      const options=negotiation.inputs.contractOptions
      if(!Array.isArray(options)||options.length!==agreement.choices.length||
        !agreement.choices.every((choice,i)=>{
          const option=options[i]
          if(option===null||typeof option!=='object'||Array.isArray(option))return false
          const recorded=option as Readonly<Record<string,unknown>>
          return recorded.key===choice.key&&recorded.dynastyId===choice.dynastyId&&
            recorded.firstConsentScore===choice.firstConsentScore&&recorded.secondConsentScore===choice.secondConsentScore&&
            recorded.mutuallyAccepted===choice.mutuallyAccepted&&recorded.minimumUtility===choice.minimumUtility
        }))continue
      const law=reviewOrdinaryAuthority(world,book,laws,{
        action:'NORMAL_MARRIAGE',sovereignCountryId:eligibility.countryId,
        issuerRef:{kind:'COUNTRY',id:eligibility.countryId},year:ctx.year,
      })
      if(law.status!=='AUTHORIZED')continue
      const candidateId='candidate:nextgen:'+JSON.stringify([ctx.year,pair,agreement.choice.key])
      const contract=negotiatedMarriageContract(ctx.year,pair,agreement.choice,verified.traceId)
      // 候補は当年の同意Traceから生成したものだけ。過去・他婚姻の契約を流用しない。
      candidates.push({
        candidateId,personIds:pair,contract,
        registration:'NOT_REGISTERED',provenance:'CALIBRATION_ONLY',
      })
      if(matching[0])registrations.push(matching[0].registration)
      reviews.push({
        reviewId:'review:nextgen:'+JSON.stringify([ctx.year,pair,verified.traceId]),
        personIds:pair,countryId:eligibility.countryId,lawId:law.lawId,
        reviewedBy:{kind:'COUNTRY',id:eligibility.countryId},
        availableFromYear:ctx.year,endExclusiveYear:ctx.year+1,
        contractCandidateId:candidateId,status:'ELIGIBLE',provenance:'CALIBRATION_ONLY',
      })
    }
    const normal=createALeg01OrdinaryEvaluator({
      book:{...book,marriageCandidates:candidates},
      laws,reviews,supportingRegistrations:registrations,
    })
    if(!normal.ok)throw new EvaluationFailure('当年の婚姻法的審査の入力が不正',
      normal.issues.map(e=>({code:'INVALID_NEXTGEN_LEGAL_REVIEW',message:e})))
    return normal.evaluator(world,ctx)
  }
  if (resolveSupporting) supportingEvidence.set(evaluator, Object.freeze({
    resolve: resolveSupporting, clearanceKey: supportingClearanceKey(stableClearances),
  }))
  return {ok:true,evaluator}
}
