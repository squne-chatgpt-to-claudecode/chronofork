// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {createExperimentalIntegratedWorld} from '../../../../src/scenario/experimental/index.ts'
import type {ObservationSlice} from '../../../../src/ui/branch-play-source.ts'
import type {EventLogEntry} from '../../../../src/simulation/contracts/index.ts'
import {namesOf,eventHeadline} from '../../../../src/ui/integrated-overview.ts'
import {describeEvent} from '../../../../src/ui/event-summary.ts'
import {ObservationPanel} from '../../../../src/ui/observation/ObservationPanel.tsx'
import {buildTitleHoldingHistories} from '../../../../src/ui/observation/title-history.ts'

afterEach(cleanup)
const world=createExperimentalIntegratedWorld()
const holder=world.persons.find(p=>p.personId==='person-exp-02')!

it('出生年内の法的王朝Eventは確定済み出生Eventの名前で表示し、人物IDを画面文言に漏らさない',()=>{
  const id='person:b002:auto:synthetic-hash'
  const birth={
    eventId:'e-birth',eventType:'PERSON_BIRTH',year:1252,
    involvedRefs:[{kind:'PERSON',id}],sourceTraceIds:[],
    stateChanges:[{path:'$.persons['+id+']',before:null,after:{...holder,personId:id,name:'王家の子 1252'}}],
  } as unknown as EventLogEntry
  const dynasty={
    eventId:'e-dynasty',eventType:'LEGAL_DYNASTY_SET',year:1252,
    involvedRefs:[{kind:'PERSON',id}],sourceTraceIds:[],
    stateChanges:[
      {path:'$.persons['+id+'].legalDynasty.status',before:'UNDETERMINED',after:'DETERMINED'},
      {path:'$.persons['+id+'].legalDynasty.dynastyId',before:null,after:'dynasty-nalven'},
    ],
  } as unknown as EventLogEntry
  const names=namesOf(world,[birth,dynasty])
  expect(names.person(id)).toBe('王家の子 1252')
  const headline=describeEvent(dynasty,names)?.headline??eventHeadline(dynasty,names,'法的王朝')
  expect(headline).toContain('王家の子 1252')
  expect(headline).not.toContain(id)
  expect(eventHeadline(dynasty,namesOf(world),'法的王朝')).not.toContain(id)
})

it('1350年の目標を年表より前に提示し、1252年初の未確定を1251年の記録へ遡れる',()=>{
  const crown=world.titles.find(t=>t.kind==='CROWN')!
  const moved={...world,year:1251,titles:world.titles.map(t=>t.titleId===crown.titleId
    ?{...t,holder:{status:'HELD' as const,personId:holder.personId}}:t)}
  const unsettled={...world,year:1252,titles:moved.titles.map(t=>t.titleId===crown.titleId
    ?{...t,holder:{status:'UNDETERMINED' as const}}:t)}
  const v:ObservationSlice={
    seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,world,
    events:[],traces:[],counts:[],candidates:{seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',candidates:[]},
    titleHistories:buildTitleHoldingHistories([world,moved,unsettled],[]),
    knownA0Ending:null,technicalGoal:null,goal:null,status:'COMPLETED',a0Source:'COMPUTED',
  }
  const onLoad=vi.fn()
  render(<ObservationPanel observation={v} loading={false} seedText="20260101"
    onSeedText={vi.fn()} onReset={vi.fn()} onLoad={onLoad} onCancel={vi.fn()} onIntervene={vi.fn()}/>)
  const goal=screen.getByTestId('obs-goal')
  const timeline=screen.getByTestId('obs-title-timeline')
  const year=screen.getByTestId('obs-year-slider')
  expect(goal.compareDocumentPosition(timeline)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(timeline.compareDocumentPosition(year)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(goal.textContent).toContain('1350年、ナルヴェン家の世襲領地を残す')
  expect(timeline.textContent).toContain('保持者未確定')
  fireEvent.click(screen.getByTestId('obs-title-turning-'+crown.titleId))
  expect(onLoad).toHaveBeenCalledWith(1251)
})

it('称号の年表は保持者未確定を正式な相続と断定せず、移転Eventの有無を区別する',()=>{
  const crown=world.titles.find(t=>t.kind==='CROWN')!
  const next={...world,year:1251,titles:world.titles.map(t=>t.titleId===crown.titleId
    ?{...t,holder:{status:'UNDETERMINED' as const}}:t)}
  const v:ObservationSlice={
    seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,world,
    events:[],traces:[],counts:[],candidates:{seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',candidates:[]},
    titleHistories:buildTitleHoldingHistories([world,next],[]),
    knownA0Ending:null,technicalGoal:null,goal:null,status:'COMPLETED',a0Source:'COMPUTED',
  }
  render(<ObservationPanel observation={v} loading={false} seedText="20260101"
    onSeedText={vi.fn()} onReset={vi.fn()} onLoad={vi.fn()} onCancel={vi.fn()} onIntervene={vi.fn()}/>)
  const list=screen.getByTestId('obs-title-chronicle')
  expect(list.textContent).toContain('年初状態から確認')
  expect(list.textContent).not.toContain('合法に相続')
})
