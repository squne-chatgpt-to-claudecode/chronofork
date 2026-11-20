// Issue #83: C004実出生履歴を出典としたSUPPORTING成年者→禁親確認→婚姻→実出生。
import {describe,expect,it} from 'vitest'
import {createExperimentalWorld,createExperimentalOrdinaryLegalTrial} from '../../../src/scenario/experimental/index.ts'
import type {PairTrustBase,WorldState} from '../../../src/simulation/contracts/index.ts'
import {runYear} from '../../../src/simulation/engine/index.ts'
import {createCalibrationEvaluators} from '../../../src/simulation/rules/c/index.ts'
import {EXPERIMENTAL_TUNING} from '../../../src/simulation/tuning.ts'
import {createAutonomousCalibrationEvaluators,EXPERIMENTAL_AUTONOMY} from '../../../src/simulation/autonomy/index.ts'
import {supportingCandidateId} from '../../../src/simulation/population/supporting-marriage.ts'
import type {SupportingMarriageCohort} from '../../../src/simulation/population/supporting-marriage.ts'
import type {SupportingKinshipClearance} from '../../../src/simulation/rules/a/index.ts'

const initial=createExperimentalWorld()
const seed=291001
const start:WorldState={...initial,demographics:{cohortSlots:[],anonymousBirthHistory:[]}}
const c4=createCalibrationEvaluators(EXPERIMENTAL_TUNING)
const trial=createExperimentalOrdinaryLegalTrial()
const cohort:SupportingMarriageCohort={
  cohortId:'trial:actual-C004-births-1250-east',groupId:'group-east-elite',
  affiliationHouseId:'house-cardon',familyPoolId:'trial:independently-observed-survivor',
  tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1250,memberCount:1,
  source:'C004_COHORT',sourceEvidenceId:'trial:year-1250-C004-group-east-elite',
  survivorAttestationId:'trial:year-1268-separate-census-alive',
  provenance:'CALIBRATION_ONLY',
}
const id=supportingCandidateId(cohort.cohortId,0)
const p2='person-exp-02'
const pair=[p2,id].sort() as [string,string]
const clearance:SupportingKinshipClearance={
  clearanceId:'trial:unrelated-kinship-check-1268',personIds:pair,countryId:'country-eldia',
  checkedYear:1268,validUntilYear:1270,
  sourceEvidenceId:'trial:distinct-lineage-document',provenance:'CALIBRATION_ONLY',
}
const config={cohorts:[cohort],maxRecordsPerYear:1,maxAliveSupporting:1,perCohortSamples:1,maximumPreviewAge:60}
// 2年間のCALIBRATION_ONLY分離試験。死亡と出生確率だけを固定し、出生枠・婚姻・契約は年次評価する。
const auto={...EXPERIMENTAL_AUTONOMY,
  birth:{...EXPERIMENTAL_AUTONOMY.birth,minMotherAge:18,maxMotherAge:40,minFatherAge:18,chancePermille:1000},
  death:{...EXPERIMENTAL_AUTONOMY.death,basePermille:0,maxPermille:0},
}
function toAdult():WorldState{
  let w=start
  for(let year=1250;year<1268;year++){
    const next=runYear(w,{seed,evaluators:c4})
    if(next.status!=='COMPLETED')throw new Error('C004_PREP:'+year+JSON.stringify(next.halt))
    w=next.world
  }
  return w
}
function calendar(world:WorldState,clearances:readonly SupportingKinshipClearance[],
  trustBase:readonly PairTrustBase[]=[],candidateTrust=40,supportingMarriage=config){
  const result=createAutonomousCalibrationEvaluators({branchStartWorld:world,ledger:[],trustBase,
    supportingMarriage,supportingCandidateTrustBase:[{personIds:pair,value:candidateTrust}],
    nextgenMarriage:{book:trial.book,laws:trial.laws,supportingKinshipClearances:clearances},
    autonomy:auto,
  })
  if(!result.ok)throw new Error('AUTONOMY_CONFIG:'+result.issues.join(','))
  return result.evaluators
}

describe('DEC-061: 過去年C004の匿名出生→非操作配偶者→翌年実出生',()=>{
  it('禁親証拠なしの高得点補助候補が、別の適格KEY候補を順位上占有しない',()=>{
    const alternative='person-exp-05'
    const keyPair=[p2,alternative].sort() as [string,string]
    const adult=toAdult()
    const r=runYear(adult,{seed,evaluators:calendar(adult,[],[{personIds:keyPair,value:40}],90)})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const b5=r.traces.filter(t=>t.ruleId==='B-005'&&t.actorRef.kind==='PERSON_PAIR')
    const support=b5.find(t=>t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.join('|')===pair.join('|'))
    const key=b5.find(t=>t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.join('|')===keyPair.join('|'))
    expect(support?.status).toBe('DEFER')
    expect(support?.reasonCodes).toContain('SUPPORTING_KINSHIP_CLEARANCE_MISSING')
    expect(key?.status).toBe('ACCEPT')
    expect(r.world.legal.marriages.every(m=>!m.personIds.includes(id))).toBe(true)
  })
  it('別個の禁親証拠がなければ婚姻・出生を登録しない',()=>{
    const adult=toAdult()
    const r=runYear(adult,{seed,evaluators:calendar(adult,[])})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    expect(r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(0)
    expect(r.world.persons.some(p=>p.personId===id)).toBe(false)
    expect(r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER')).toHaveLength(0)
    expect(r.events.filter(e=>e.eventType==='PERSON_BIRTH')).toHaveLength(0)
    expect(r.world.legal.marriages).toEqual(initial.legal.marriages)
  })
  it.each(['source','survivor','birth'] as const)('人口証拠欠落(%s)を理由付きで保留する',missing=>{
    const adult=toAdult()
    const input=missing==='birth'?{...adult,demographics:{cohortSlots:[]}}:adult
    const cohorts=[{...cohort,...(missing==='source'?{sourceEvidenceId:''}:
      missing==='survivor'?{survivorAttestationId:cohort.sourceEvidenceId}:{})}]
    const reason={source:'COHORT_SOURCE_EVIDENCE_MISSING:0',survivor:'C004_SURVIVOR_ATTESTATION_MISSING:0',
      birth:'C004_BIRTH_BACKING_INSUFFICIENT:0'}[missing]
    const r=runYear(input,{seed,evaluators:calendar(input,[clearance],[],40,{...config,cohorts})})
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    expect(r.traces.some(t=>t.ruleId==='B-001'&&t.status==='DEFER'&&t.reasonCodes.includes(reason))).toBe(true)
    expect(r.world.persons.some(p=>p.personId===id)).toBe(false)
    expect(r.events.some(e=>e.eventType==='MARRIAGE_REGISTER'||e.eventType==='PERSON_BIRTH')).toBe(false)
  })
  it('実C004出典で1268年に登録・法的婚姻、1269年に実出生と契約に応じた法的王朝を記録',()=>{
    const adult=toAdult()
    expect(adult.demographics.anonymousBirthHistory?.find(h=>h.groupId===cohort.groupId&&h.year===1250)
      ?.anonymousBirths).toBeGreaterThanOrEqual(cohort.memberCount)
    expect(adult.persons.some(p=>p.personId===id)).toBe(false)
    const evaluators=calendar(adult,[clearance])
    const r=runYear(adult,{seed,evaluators})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const spouse=r.world.persons.find(p=>p.personId===id)
    expect(spouse).toMatchObject({interactionRole:'SUPPORTING',birthYear:1250,
      legalDynasty:{status:'UNDETERMINED'},originGroupId:cohort.groupId})
    const marriage=r.world.legal.marriages.find(m=>m.personIds.join('|')===pair.join('|'))
    expect(marriage?.status).toBe('ACTIVE')
    expect(r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(0)
    const registrations=r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER').flatMap(e=>e.supportingMarriageRegistrations??[])
    expect(registrations).toMatchObject([{marriageId:marriage?.marriageId,registration:{
      person:spouse,cohortId:cohort.cohortId,memberOrdinal:0,birthBacking:'C004_COHORT',
      sourceEvidenceId:cohort.sourceEvidenceId,survivorAttestationId:cohort.survivorAttestationId,
    }}])
    // 1268年C004の通常人口変化だけが発生し、個別人物の登録で人口は増えない。
    const populationOnly=runYear(adult,{seed,evaluators:c4})
    if(populationOnly.status!=='COMPLETED')throw new Error('C004_COMPARISON')
    expect(r.world.groups).toEqual(populationOnly.world.groups)
    expect(r.world.demographics).toEqual(populationOnly.world.demographics)
    const byPair=(ruleId:string)=>r.traces.find(t=>t.ruleId===ruleId&&t.actorRef.kind==='PERSON_PAIR'&&
      JSON.stringify(t.actorRef.ids)===JSON.stringify(pair))
    const supply=r.traces.find(t=>t.ruleId==='B-001'&&t.status==='ACCEPT'&&
      t.candidates[0]?.inputs.supportingCandidateId===id&&t.candidates[0]?.inputs.seekerPersonId===p2)
    expect(supply?.eventIds).toEqual([])
    expect(byPair('B-004')).toMatchObject({status:'ACCEPT',candidates:[{inputs:{trustSource:'CALIBRATION_ONLY_CANDIDATE_BASE'}}]})
    const negotiation=byPair('B-005')
    expect(negotiation?.status).toBe('ACCEPT')
    expect(negotiation?.candidates[0]?.inputs.supportingKinshipClearanceId).toBe(clearance.clearanceId)
    const legal=byPair('A-LEG-01')
    expect(legal?.status).toBe('ACCEPT')
    const marriageEvent=r.events.find(e=>e.eventType==='MARRIAGE_REGISTER'&&e.supportingMarriageRegistrations?.length)
    expect(marriageEvent?.sourceTraceIds).toEqual([legal?.traceId])
    expect(registrations[0]?.requestId).toBe(negotiation?.candidates[0]?.inputs.sourceRequestId)
    expect(runYear(adult,{seed,evaluators})).toEqual(r)
    const born=runYear(r.world,{seed,evaluators})
    expect(born.status).toBe('COMPLETED')
    if(born.status!=='COMPLETED')return
    const children=born.world.persons.filter(p=>p.birthYear===1269&&p.fatherId===p2&&p.motherId===id)
    expect(children).toHaveLength(1)
    const child=children[0]!
    const forChild=(ruleId:string)=>born.traces.find(t=>t.ruleId===ruleId&&t.actorRef.kind==='PERSON'&&t.actorRef.id===child.personId)
    const birth=forChild('B-002')
    expect(birth?.status).toBe('ACCEPT')
    const birthEvent=born.events.find(e=>e.eventType==='PERSON_BIRTH'&&e.sourceTraceIds.includes(birth!.traceId))
    expect(birthEvent?.eventId).toEqual(expect.any(String))
    const dynasty=forChild('A-DYN-02')
    const contract=marriage?.contract
    expect(contract?.evidenceId).toEqual(expect.any(String))
    const clause=contract?.clauses.find(c=>c.kind==='CHILD_LEGAL_DYNASTY')
    expect(dynasty?.candidates[0]?.inputs).toMatchObject({sourceBirthEventIds:[birthEvent?.eventId],
      sourceB002TraceId:birth?.traceId,contractId:contract?.contractId,contractEvidenceId:contract?.evidenceId})
    if(clause){
      expect(dynasty?.status).toBe('ACCEPT')
      expect(child.legalDynasty).toEqual({status:'DETERMINED',dynastyId:clause.dynastyId})
      expect(born.events.some(e=>e.eventType==='LEGAL_DYNASTY_SET'&&e.sourceTraceIds.includes(dynasty!.traceId))).toBe(true)
    }else{
      expect(dynasty?.status).toBe('DEFER')
      expect(dynasty?.reasonCodes).toContain('GAME_01_DYNASTY_CLAUSE_MISSING')
      expect(child.legalDynasty.status).toBe('UNDETERMINED')
    }
    expect(born.world.persons.find(p=>p.personId===id)?.interactionRole).toBe('SUPPORTING')
    // 当年の人口加算はC004で済んでおり、B002は1枠を匿名から個別に割り当てるだけ。
    const anonymousOnly=runYear(r.world,{seed,evaluators:c4})
    if(anonymousOnly.status!=='COMPLETED')throw new Error('C004_BIRTH_COMPARISON')
    const anonymous=(w:WorldState)=>w.demographics.anonymousBirthHistory?.find(h=>h.groupId===cohort.groupId&&h.year===1269)?.anonymousBirths
    expect(born.world.groups).toEqual(anonymousOnly.world.groups)
    expect(anonymous(born.world)).toBe(anonymous(anonymousOnly.world)!-1)
    expect(runYear(r.world,{seed,evaluators})).toEqual(born)
    console.info('DEC061_C004_CALIBRATION_ONLY',JSON.stringify({
      supplyTraceId:supply?.traceId,negotiationTraceId:negotiation?.traceId,legalTraceId:legal?.traceId,
      requestId:registrations[0]?.requestId,marriageEventId:marriageEvent?.eventId,marriageId:marriage?.marriageId,
      contractId:contract?.contractId,contractEvidenceId:contract?.evidenceId,clauseId:clause?.clauseId,
      birthEventId:birthEvent?.eventId,birthTraceId:birth?.traceId,childId:child.personId,
      dynastyTraceId:dynasty?.traceId,legalDynasty:child.legalDynasty,
    }))
  },120000)
})
