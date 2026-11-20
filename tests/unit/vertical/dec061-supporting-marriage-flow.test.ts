// Issue #83 integration slice: 抽象候補→B004/B005合意→A-LEG-01法的婚姻時にSUPPORTING記録。
// すべてCALIBRATION_ONLYのsynthetic証拠。1350勝利・未証明の禁親非該当を偽造しない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, createExperimentalOrdinaryLegalTrial } from '../../../src/scenario/experimental/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { createB001SupportingMarriageEvaluator, createB004WorldStateEvaluator, createB005NextgenEvaluator } from '../../../src/simulation/rules/b/index.ts'
import { createALeg01NextgenEvaluator, withSpouseDeathDissolution } from '../../../src/simulation/rules/a/index.ts'
import type { EvaluatorMap, RuleEvaluator, YearRunResult } from '../../../src/simulation/engine/index.ts'
import type { DomainCommand, RuleOutcome } from '../../../src/simulation/contracts/index.ts'
import type { B001SupportingInput } from '../../../src/simulation/rules/b/b001-supporting-marriage.ts'
import { createPairTrustView } from '../../../src/simulation/intervention/index.ts'
import { createAutonomousCalibrationEvaluators, EXPERIMENTAL_AUTONOMY } from '../../../src/simulation/autonomy/index.ts'
import { createSupportingCandidateResolver } from '../../../src/simulation/autonomy/supporting-candidate-view.ts'
import { proposeSupportingMarriageCandidates, supportingCandidateId } from '../../../src/simulation/population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../../src/simulation/population/supporting-marriage.ts'
import type { SupportingKinshipClearance } from '../../../src/simulation/rules/a/index.ts'

const world=createExperimentalWorld()
const SEED=2026
const seeker='person-exp-01'
const cohort:SupportingMarriageCohort={
  cohortId:'synthetic:eldia-east-1230-female',groupId:'group-east-elite',
  affiliationHouseId:'house-cardon',familyPoolId:'synthetic:documented-distinct-family',
  tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1230,memberCount:1,
  source:'INITIAL_POPULATION',sourceEvidenceId:'synthetic:initial-population:1230:eldia-east',
  provenance:'CALIBRATION_ONLY',
}
const predicted=proposeSupportingMarriageCandidates(world,seeker,[cohort],{
  seed:SEED,maxCandidates:1,perCohortSamples:4,maximumPreviewAge:50,
})
if(predicted.status!=='PROPOSED')throw new Error('SYNTHETIC_SUPPLY_MISSING:'+predicted.reasonCodes.join(','))
const supportId=predicted.candidates[0]!.candidateId
const config={cohorts:[cohort],maxRecordsPerYear:1,maxAliveSupporting:2,perCohortSamples:4,maximumPreviewAge:50,
  candidatePairs:[[seeker,supportId] as const]}
const pair=orderedPair(seeker,supportId)
const trial=createExperimentalOrdinaryLegalTrial()
const clearance:SupportingKinshipClearance={
  clearanceId:'synthetic:independent-kinship-review:1250',
  personIds:pair,countryId:'country-eldia',
  checkedYear:1250,validUntilYear:1251,
  sourceEvidenceId:'synthetic:independent-kinship-register:not-the-cohort-census',
  provenance:'CALIBRATION_ONLY',
}
function orderedPair(a:string,b:string):readonly [string,string]{ return a < b ? [a,b] : [b,a] }
function execute(clearances:readonly SupportingKinshipClearance[],
  override:(evaluators:EvaluatorMap)=>EvaluatorMap=base=>base, settings:B001SupportingInput=config,
  negotiationClearances=clearances, input=world){
  const supply=createB001SupportingMarriageEvaluator(settings)
  if(!supply.ok)throw new Error('SUPPLY_FACTORY:'+supply.issues.join(','))
  const resolver=createSupportingCandidateResolver(settings)
  const trustBase=(settings.candidatePairs??[]).map(([a,b])=>({personIds:orderedPair(a,b),value:40}))
  const trust=createPairTrustView({base:[],ledger:[],knownPersonIds:new Set(world.persons.map(p=>p.personId))})
  if(!trust.ok)throw new Error('TRUST_FACTORY_INVALID')
  const legal=createALeg01NextgenEvaluator({
    book:trial.book,laws:trial.laws,supportingKinshipClearances:clearances,supportingCandidateResolver:resolver,
  })
  if(!legal.ok)throw new Error('LEGAL_FACTORY:'+legal.issues.join(','))
  return runYear(input,{seed:SEED,branchId:'synthetic-A0',evaluators:override({
    'B-001':supply.evaluator,
    'B-004':createB004WorldStateEvaluator(trust.view,EXPERIMENTAL_AUTONOMY,undefined,[],
      {resolve:resolver,trustBase}),
    'B-005':createB005NextgenEvaluator(undefined,negotiationClearances,resolver),
    'A-LEG-01':withSpouseDeathDissolution(legal.evaluator),
  })})
}

function alter(rule:'B-001'|'B-004'|'B-005'|'A-LEG-01', rewrite:(out:RuleOutcome)=>RuleOutcome){
  return (base:EvaluatorMap):EvaluatorMap=>{
    const original=base[rule]!
    const replacement:RuleEvaluator=(w,ctx)=>rewrite(original(w,ctx))
    return {...base,[rule]:replacement}
  }
}
function expectRejected(r:YearRunResult,message:string){
  expect(r).toMatchObject({status:'HALTED',halt:{ruleId:'A-LEG-01',code:'INVALID_OUTCOME',message:expect.stringContaining(message)}})
  expect(r.world).toEqual(world)
}
function registration(out:RuleOutcome){
  const c=out.commands.find(c=>c.type==='MARRIAGE_REGISTER'&&c.supportingPerson!==undefined)
  if(c?.type!=='MARRIAGE_REGISTER'||!c.supportingPerson)throw new Error('TEST_SUPPORTING_REGISTRATION_MISSING')
  return c as typeof c & {supportingPerson:NonNullable<typeof c.supportingPerson>}
}

describe('DEC-061 Issue #83: 人口候補から非操作配偶者の法的婚姻へ（限定試験）',()=>{
  it('抽象候補の提示だけでは人物・人口・重要人物・王朝を増やさない',()=>{
    const r=execute([])
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const newPeople=r.world.persons.filter(p=>!world.persons.some(old=>old.personId===p.personId))
    expect(newPeople).toHaveLength(0)
    expect(r.world.groups).toEqual(world.groups)
    expect(r.world.titles).toEqual(world.titles)
    expect(r.world.persons.filter(p=>p.interactionRole!=='SUPPORTING')).toHaveLength(world.persons.length)
    expect(r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(0)
    expect(r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER')).toHaveLength(0)
    expect(r.traces.some(t=>t.ruleId==='B-001'&&t.reasonCodes.includes('SUPPORTING_CANDIDATE_ONLY')&&
      t.reasonCodes.includes('NOT_MARRIAGE_APPROVAL')&&
      t.candidates.some(c=>c.inputs['supportingCandidateId']===supportId))).toBe(true)
  })
  it('別個の禁親審査と当年双方合意・法令が揃った場合のみ婚姻がEvent/WorldStateに確定する',()=>{
    const r=execute([clearance])
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const marriages=r.world.legal.marriages.filter(m=>m.status==='ACTIVE'&&m.personIds.join('|')===pair.join('|'))
    expect(marriages).toHaveLength(1)
    expect(r.world.persons.find(p=>p.personId===supportId)).toMatchObject({
      interactionRole:'SUPPORTING',birthYear:1230,originGroupId:cohort.groupId,
      legalDynasty:{status:'UNDETERMINED'},
    })
    expect(r.world.persons).toHaveLength(world.persons.length+1)
    expect(r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(0)
    const registrations=r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER')
    expect(registrations).toHaveLength(1)
    const event=registrations[0]!
    const matches=r.traces.filter(t=>t.status==='ACCEPT'&&t.actorRef.kind==='PERSON_PAIR'&&
      t.actorRef.ids.join('|')===pair.join('|'))
    expect(matches.map(t=>t.ruleId)).toEqual(['B-004','B-005','A-LEG-01'])
    const [b4,b5,legal]=matches
    const b1=r.traces.find(t=>t.ruleId==='B-001'&&t.status==='ACCEPT'&&
      t.candidates[0]?.inputs.supportingCandidateId===supportId)
    expect(b1?.eventIds).toEqual([])
    expect(b4?.candidates[0]?.inputs.trustSource).toBe('CALIBRATION_ONLY_CANDIDATE_BASE')
    expect(b5?.candidates[0]?.inputs).toMatchObject({sourceB004TraceId:b4?.traceId,
      supportingKinshipClearanceId:clearance.clearanceId})
    const requestId=b5?.candidates[0]?.inputs.sourceRequestId
    expect(requestId).toEqual(expect.any(String))
    expect(legal?.candidates[0]?.inputs).toMatchObject({sourceRequestId:requestId,
      contractId:marriages[0]?.contract?.contractId})
    expect(legal?.eventIds).toEqual([event.eventId])
    expect(event.sourceTraceIds).toEqual([legal?.traceId])
    expect(event.supportingMarriageRegistrations).toMatchObject([{
      requestId,sourceTraceId:legal?.traceId,marriageId:marriages[0]?.marriageId,
      registration:{person:r.world.persons.find(p=>p.personId===supportId),
        cohortId:b1?.candidates[0]?.inputs.cohortId,memberOrdinal:b1?.candidates[0]?.inputs.memberOrdinal,
        sourceEvidenceId:cohort.sourceEvidenceId,birthBacking:'INITIAL_POPULATION'},
    }])
    expect(r.world.groups).toEqual(world.groups)
    expect(r.world.regions).toEqual(world.regions)
    expect(r.world.legal.controlMandates).toEqual(world.legal.controlMandates)
    expect(r.world.legal.taxMandates).toEqual(world.legal.taxMandates)
    expect(execute([clearance])).toEqual(r)
  })
  it('補助候補の集団出典だけ、他ペアの禁親証拠、期限切れ証拠では婚姻を成立させない',()=>{
    const unrelated:SupportingKinshipClearance={...clearance,
      clearanceId:'synthetic:wrong-pair',personIds:['person-exp-02',supportId].sort() as [string,string]}
    const expired:SupportingKinshipClearance={...clearance,checkedYear:1249,validUntilYear:1250}
    const sameSource:SupportingKinshipClearance={...clearance,sourceEvidenceId:cohort.sourceEvidenceId}
    for(const refs of [[],[unrelated],[expired],[sameSource]]){
      const r=execute(refs)
      expect(r.status).toBe('COMPLETED')
      if(r.status!=='COMPLETED')continue
      expect(r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER')).toHaveLength(0)
      expect(r.world.persons).toEqual(world.persons)
      expect(r.world.legal.marriages).toEqual(world.legal.marriages)
    }
  })
  it('別コホートの人口出典・生存確認IDも個別禁親の独立証拠として流用できない',()=>{
    const second:SupportingMarriageCohort={...cohort,cohortId:'synthetic:unselected-C004',birthYear:1250,
      source:'C004_COHORT',familyPoolId:'synthetic:second-family',sourceEvidenceId:'synthetic:other-birth',
      survivorAttestationId:'synthetic:other-survivor'}
    for(const sourceEvidenceId of [second.sourceEvidenceId,second.survivorAttestationId!]){
      const r=execute([{...clearance,sourceEvidenceId}],base=>base,{...config,cohorts:[cohort,second]})
      if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
      expect(r.traces.some(t=>t.ruleId==='B-005'&&t.status==='DEFER'&&
        t.reasonCodes.includes('SUPPORTING_KINSHIP_CLEARANCE_MISSING'))).toBe(true)
      expect(r.events.flatMap(e=>e.supportingMarriageRegistrations??[])).toEqual([])
      expect(r.world.persons).toEqual(world.persons)
    }
  })
  it.each([false,true])('別探索者の予算不足（残り0枠: %s）で別ペアを一意首位に繰り上げない',openMember=>{
    const other='person-exp-02'
    const second:SupportingMarriageCohort={...cohort,cohortId:'synthetic:second-female',birthYear:1229,
      familyPoolId:'synthetic:second-family',sourceEvidenceId:'synthetic:second-census'}
    const secondId=supportingCandidateId(second.cohortId,0)
    const kinshipClearances=[clearance,...[supportId,secondId].map((id,i)=>({...clearance,
      clearanceId:'synthetic:kinship:alternate:'+i,personIds:orderedPair(other,id)}))]
    const input=openMember?{...world,persons:[...world.persons,{personId:secondId,name:secondId,sex:'FEMALE' as const,
      interactionRole:'SUPPORTING' as const,alive:true,birthYear:second.birthYear,originGroupId:second.groupId,
      houseId:second.affiliationHouseId,legalDynasty:{status:'UNDETERMINED' as const,reasonCodes:[]}}]}:world
    const settings:B001SupportingInput={...config,cohorts:[cohort,second],kinshipClearances,
      maxOpenCandidatesPerSeeker:1,candidatePairs:[[seeker,supportId],[other,supportId],[other,secondId]]}
    const r=execute(kinshipClearances,base=>base,settings,kinshipClearances,input)
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    const supplyReason=openMember?'OPEN_EVIDENCE_BACKED_CANDIDATES_AT_LIMIT':'SUPPORTING_CANDIDATE_BUDGET_EXCEEDED'
    expect(r.traces.some(t=>t.ruleId==='B-001'&&t.actorRef.kind==='PERSON'&&t.actorRef.id===other&&
      t.status==='DEFER'&&t.reasonCodes.includes(supplyReason))).toBe(true)
    expect(r.traces.some(t=>t.ruleId==='B-005'&&t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.includes(seeker)&&
      t.status==='DEFER'&&t.reasonCodes.includes('SUPPORTING_CANDIDATE_BUDGET_EXCEEDED'))).toBe(true)
    expect(r.world.legal.marriages).toEqual(input.legal.marriages)
    expect(r.world.persons).toEqual(input.persons)
  })
  it('候補供給のTraceを削って既登録ペアを繰り上げることはできない',()=>{
    const keyPair=orderedPair('person-exp-02','person-exp-05')
    const setup=createAutonomousCalibrationEvaluators({branchStartWorld:world,ledger:[],
      trustBase:[{personIds:keyPair,value:40}],nextgenMarriage:{book:trial.book,laws:trial.laws},
      supportingMarriage:config})
    if(!setup.ok)throw new Error(setup.issues.join(','))
    const evaluators=alter('B-001',out=>({...out,traceDrafts:[]}))(setup.evaluators)
    const r=runYear(world,{seed:SEED,evaluators})
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    expect(r.traces.some(t=>t.ruleId==='B-005'&&t.actorRef.kind==='PERSON_PAIR'&&
      JSON.stringify(t.actorRef.ids)===JSON.stringify(keyPair)&&t.status==='DEFER'&&
      t.reasonCodes.includes('SUPPORTING_SUPPLY_UNVERIFIED'))).toBe(true)
    expect(r.world.legal.marriages).toEqual(world.legal.marriages)
  })
  it('照会外の補助人物登録を拒否する',()=>{
    const r=execute([clearance],alter('A-LEG-01',out=>{
      const c=registration(out)
      return {...out,commands:[...out.commands,{...c,commandId:'test:out-of-query',
        source:{...c.source,requestId:'test:out-of-query'}}]}
    }))
    expectRejected(r,'照会外')
  })
  it('同じ候補の二重登録を拒否して年初状態へ戻す',()=>{
    const r=execute([clearance],alter('A-LEG-01',out=>{
      const c=registration(out)
      return {...out,commands:[...out.commands,{...c,commandId:'test:duplicate-person'}]}
    }))
    expectRejected(r,'同じ補助候補')
  })
  it('B-001と異なる人口出典・人物属性を登録しない',()=>{
    const r=execute([clearance],alter('A-LEG-01',out=>{
      const c=registration(out)
      return {...out,commands:[{...c,supportingPerson:{...c.supportingPerson,
        sourceEvidenceId:'test:forged-census',person:{...c.supportingPerson.person,name:'改変された名前'}}}]}
    }))
    expectRejected(r,'B-001候補供給から再導出できません')
  })
  it('ordinalを書き換えたB-001 Traceは候補供給の証拠として使わない',()=>{
    const r=execute([clearance],alter('B-001',out=>({...out,traceDrafts:out.traceDrafts.map(d=>({...d,
      candidates:d.candidates.map(c=>c.inputs.supportingCandidateId!==supportId?c:
        {...c,inputs:{...c.inputs,memberOrdinal:99}}),
    }))})))
    expect(r.status).toBe('COMPLETED')
    expect(r.world.persons).toEqual(world.persons)
    expect(r.world.legal.marriages).toEqual(world.legal.marriages)
  })
  it.each(['B-004','B-005'] as const)('%sの自己申告Traceを正規評価の代用にしない',rule=>{
    const r=execute([clearance],alter(rule,out=>({...out,traceDrafts:out.traceDrafts.map(d=>
      d.status!=='ACCEPT'?d:{...d,candidates:d.candidates.map(c=>rule==='B-004'?
        {...c,score:(c.score??0)+1}:{...c,inputs:{...c.inputs,selectionEvidence:'test:forged-top'}})})})))
    expectRejected(r,'正規のB-004・B-005・A-LEG-01審査')
  })
  it('正規のACCEPT Traceと応答に見せかけて契約証拠だけ差し替えるOutcomeを拒否する',()=>{
    const r=execute([clearance],alter('A-LEG-01',out=>{
      const c=registration(out)
      if(!c.marriage.contract)throw new Error('TEST_CONTRACT_MISSING')
      const forged:DomainCommand={...c,marriage:{...c.marriage,
        contract:{...c.marriage.contract,evidenceId:'test:forged-agreement'}}}
      return {...out,commands:[forged]}
    }))
    expectRejected(r,'正規のB-004・B-005・A-LEG-01審査')
  })
  it('B-005照会のrequestId重複を拒否する',()=>{
    const r=execute([clearance],alter('B-005',out=>({...out,requests:[...out.requests,...out.requests]})))
    expect(r).toMatchObject({status:'HALTED',halt:{ruleId:'B-005',code:'UNRESOLVED_CROSS_DOMAIN_REQUEST'}})
    expect(r.world).toEqual(world)
  })
  it('同じ抽象候補に対する同率の同年縁談では、どちらも登録しない',()=>{
    const other='person-exp-02'
    const r=execute([clearance,{...clearance,clearanceId:'synthetic:kinship:other',personIds:orderedPair(other,supportId)}],
      base=>base,{...config,candidatePairs:[[seeker,supportId],[other,supportId]]})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    expect(r.traces.filter(t=>t.ruleId==='B-005'&&t.reasonCodes.includes('MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED'))).toHaveLength(2)
    expect(r.world.persons).toEqual(world.persons)
    expect(r.world.legal.marriages).toEqual(world.legal.marriages)
  })
  it('同じ信頼でも家門支持に差があれば双方の相手選好に反映する',()=>{
    const second:SupportingMarriageCohort={...cohort,cohortId:'synthetic:central-female',
      groupId:'group-central-elite',affiliationHouseId:'house-nalven',familyPoolId:'synthetic:central-family',
      sourceEvidenceId:'synthetic:central-census'}
    const secondId=supportingCandidateId(second.cohortId,0)
    const r=execute([clearance,{...clearance,clearanceId:'synthetic:kinship:central',
      personIds:orderedPair(seeker,secondId)}],base=>base,{...config,cohorts:[cohort,second],
      candidatePairs:[[seeker,supportId],[seeker,secondId]]})
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    const traces=r.traces.filter(t=>t.ruleId==='B-005'&&t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.includes(seeker))
    const declined=traces.find(t=>t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.includes(supportId))
    const accepted=traces.find(t=>t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.includes(secondId))
    expect(declined).toMatchObject({status:'DEFER',candidates:[{inputs:{sourceB004Score:40,partnerHouseInterests:[0,expect.any(Number)]}}]})
    expect(accepted).toMatchObject({status:'ACCEPT',candidates:[{inputs:{sourceB004Score:40,partnerHouseInterests:[2,expect.any(Number)]}}]})
    expect(r.events.flatMap(e=>e.supportingMarriageRegistrations??[])).toMatchObject([{registration:{person:{personId:secondId}}}])
  })
  it('B-005から競合相手の禁親証拠だけを除いた台帳では登録しない',()=>{
    const other='person-exp-02'
    const r=execute([clearance,{...clearance,clearanceId:'synthetic:kinship:other',personIds:orderedPair(other,supportId)}],
      base=>base,{...config,candidatePairs:[[seeker,supportId],[other,supportId]]},[clearance])
    expectRejected(r,'禁親台帳が一致しません')
  })
  it('数値の人物IDを含む不正Outcomeは例外にせず年を停止する',()=>{
    const r=execute([clearance],base=>({...base,'B-001':(w,ctx)=>{
      const out=base['B-001']!(w,ctx)
      const traceIndex=out.traceDrafts.findIndex(d=>d.status==='ACCEPT')
      const command={type:'PERSON_PROMOTE',commandId:'test:numeric-person-id',
        source:{sourceTraceId:ctx.traceId(traceIndex)},person:{personId:123}} as unknown as DomainCommand
      return {...out,commands:[command]}
    }}))
    expect(r).toMatchObject({status:'HALTED',halt:{ruleId:'B-001',code:'INVALID_OUTCOME',message:'新規PersonのIDが文字列ではありません'}})
    expect(r.world).toEqual(world)
  })
  it('各々有効な同年二件を合算し、年間記録上限と生存補助人物上限をそれぞれ検査する',()=>{
    const second:SupportingMarriageCohort={...cohort,cohortId:'synthetic:eldia-east-1229-female',birthYear:1229,
      familyPoolId:'synthetic:second-family',sourceEvidenceId:'synthetic:initial-population:1229:eldia-east'}
    const other='person-exp-02'
    const otherId=supportingCandidateId(second.cohortId,0)
    const clearances=[clearance,{...clearance,clearanceId:'synthetic:kinship:other',personIds:orderedPair(other,otherId)}]
    const settings:B001SupportingInput={...config,cohorts:[cohort,second],
      candidatePairs:[[seeker,supportId],[other,otherId]],maxRecordsPerYear:2,maxAliveSupporting:2}
    const control=execute(clearances,base=>base,settings)
    expect(control.status).toBe('COMPLETED')
    if(control.status!=='COMPLETED')return
    expect(control.events.flatMap(e=>e.supportingMarriageRegistrations??[])).toHaveLength(2)
    for(const cap of [{maxRecordsPerYear:1},{maxAliveSupporting:1}]){
      expectRejected(execute(clearances,base=>base,{...settings,...cap}),'登録予算を超過')
    }
  })
  it('同じ人数枠の再使用・欠けた出典・個別記録の上限違反を受け付けない',()=>{
    const invalid=createB001SupportingMarriageEvaluator({...config,maxRecordsPerYear:0})
    expect(invalid).toMatchObject({ok:false})
    const over=createB001SupportingMarriageEvaluator({...config,maxAliveSupporting:0})
    expect(over).toMatchObject({ok:false})
    const duplicated={...cohort,cohortId:'synthetic:alias-of-cohort'}
    const colliding=createB001SupportingMarriageEvaluator({...config,cohorts:[cohort,duplicated]})
    expect(colliding.ok).toBe(true) // コホート照合は実WorldState時点で評価
    if(colliding.ok){
      expect(()=>runYear(world,{seed:SEED,evaluators:{'B-001':colliding.evaluator}})).not.toThrow()
      const result=runYear(world,{seed:SEED,evaluators:{'B-001':colliding.evaluator}})
      expect(result.status).toBe('HALTED')
    }
  })
})
