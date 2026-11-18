// Issue #114 担当B: 複数家門が世代を重ねる experimental 試遊構成（1250〜1350）。
// すべて CALIBRATION_ONLY。史実・正式世界設定・Goal・婚姻/出生/死亡/相続の成立を固定しない。
// 婚姻・出生・死亡・王朝所属・相続は既存B-001/002/003/004/005/009・A-LEG-01・A-DYN-02・A-SUC/A-TITの
// 毎年のWorldState評価に任せ、特定の年・人物へ予約しない。既存 integrated-run.ts は変更しない。
import type { Id, PairTrustBase, StatModifier, WorldState } from '../../simulation/contracts/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../simulation/autonomy/index.ts'
import type { EvaluatorMap } from '../../simulation/engine/index.ts'
import { EXPERIMENTAL_NEXTGEN_CONTRACT } from '../../simulation/legal/nextgen-contract.ts'
import type { NextgenContractCalibration } from '../../simulation/legal/nextgen-contract.ts'
import type { SupportingKinshipClearance } from '../../simulation/legal/supporting-kinship-clearance.ts'
import {
  B001_SUPPORTING_VERSION, B002_AUTONOMOUS_VERSION, B003_AUTONOMOUS_VERSION, B004_RULE_VERSION,
  B005_NEXTGEN_VERSION, B009_RULE_VERSION, EXPERIMENTAL_B009_CALIBRATION,
} from '../../simulation/rules/b/index.ts'
import type { B001SupportingInput } from '../../simulation/rules/b/index.ts'
import { ADYN02_RULE_VERSION, ORDINARY_MARRIAGE_VERSION, SPOUSE_DEATH_DISSOLUTION_VERSION, REVIEWED_LEGAL_VERSION }
  from '../../simulation/rules/a/index.ts'
import { EXPERIMENTAL_TUNING } from '../../simulation/tuning.ts'
import { supportingCandidateId } from '../../simulation/population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../simulation/population/supporting-marriage.ts'
import { createExperimentalWorld, NALVEN_DYNASTY_ID } from './world-1250.ts'
import { createExperimentalOrdinaryLegalTrial } from './ordinary-legal-trial.ts'
import type { ProvenanceEntry } from './provenance.ts'

export const MULTI_HOUSE_CONFIG_ID = 'experimental-multi-house-v0'
export const MULTI_HOUSE_START_YEAR = 1250
export const MULTI_HOUSE_END_YEAR = 1350
/** 既存統合構成(INTEGRATED_SEED)と比較しやすい主試遊seed。 */
export const MULTI_HOUSE_SEED = 20260101
/** 主seed以外の少数固定seed（成功例の選別をしない。全seedで同じ構成・同じ報告形式）。 */
export const MULTI_HOUSE_EXTRA_SEEDS = Object.freeze([20260202, 20260303]) as readonly number[]
export const MULTI_HOUSE_GOAL = Object.freeze({ dynastyId: NALVEN_DYNASTY_ID })

/** エルディア4地方の有力層集団 → 供給源となる所属家門（各集団の支持が最大の家門）。CALIBRATION_ONLY。 */
const SUPPLY_GROUPS = Object.freeze([
  { groupId: 'group-central-elite', houseId: 'house-nalven', key: 'central' },
  { groupId: 'group-west-elite', houseId: 'house-vargas', key: 'west' },
  { groupId: 'group-east-elite', houseId: 'house-cardon', key: 'east' },
  { groupId: 'group-south-elite', houseId: 'house-rowen', key: 'south' },
] as const)

/** 候補供給の校正値。値を変える場合はこの表だけを変更し、identityにも自動的に反映される。 */
export const MULTI_HOUSE_SUPPLY = Object.freeze({
  /** 初期人口(1250年以前出生)の未個別化の成人。各集団・性別ごと。 */
  initialBirthYears: Object.freeze([1224, 1228, 1232, 1236]) as readonly number[],
  initialMembersPerCohort: 2,
  /** C004匿名出生履歴(1250〜)から毎年各集団へ置く後年コホート。性別は年の偶奇で交互。 */
  laterFirstBirthYear: 1250,
  laterLastBirthYear: 1300,
  laterMembersPerCohort: 1,
  limits: Object.freeze({ maxRecordsPerYear: 2, maxAliveSupporting: 24, perCohortSamples: 1, maximumPreviewAge: 60, maxOpenCandidatesPerSeeker: 2 }),
})

const sexForYear = (y: number): 'MALE' | 'FEMALE' => (y % 2 === 0 ? 'FEMALE' : 'MALE')

function buildCohorts(): SupportingMarriageCohort[] {
  const out: SupportingMarriageCohort[] = []
  for (const g of SUPPLY_GROUPS) {
    for (const birthYear of MULTI_HOUSE_SUPPLY.initialBirthYears) {
      for (const sex of ['MALE', 'FEMALE'] as const) {
        const id = `multi-house:initial:${g.key}:${birthYear}:${sex.toLowerCase()}`
        out.push({
          cohortId: id, groupId: g.groupId, affiliationHouseId: g.houseId,
          familyPoolId: `multi-house:family-pool:${id}`, // 供給源ラベル。無血縁の証明ではない。
          tier: 'REGIONAL_LOWER_NOBILITY', sex, birthYear,
          memberCount: MULTI_HOUSE_SUPPLY.initialMembersPerCohort,
          source: 'INITIAL_POPULATION', sourceEvidenceId: `multi-house:initial-census:${g.key}:${birthYear}`,
          provenance: 'CALIBRATION_ONLY',
        })
      }
    }
    for (let birthYear = MULTI_HOUSE_SUPPLY.laterFirstBirthYear; birthYear <= MULTI_HOUSE_SUPPLY.laterLastBirthYear; birthYear++) {
      const sex = sexForYear(birthYear)
      const id = `multi-house:c004:${g.key}:${birthYear}:${sex.toLowerCase()}`
      out.push({
        cohortId: id, groupId: g.groupId, affiliationHouseId: g.houseId,
        familyPoolId: `multi-house:family-pool:${id}`,
        tier: 'REGIONAL_LOWER_NOBILITY', sex, birthYear,
        memberCount: MULTI_HOUSE_SUPPLY.laterMembersPerCohort,
        source: 'C004_COHORT', sourceEvidenceId: `multi-house:c004-birth:${g.key}:${birthYear}`,
        survivorAttestationId: `multi-house:survivor-census:${g.key}:${birthYear}`,
        provenance: 'CALIBRATION_ONLY',
      })
    }
  }
  return out
}
export const MULTI_HOUSE_SUPPORTING_COHORTS: readonly SupportingMarriageCohort[] = Object.freeze(buildCohorts())
export const MULTI_HOUSE_SUPPORTING_LIMITS = MULTI_HOUSE_SUPPLY.limits

/** 個別化された場合の候補ID（cohort×ordinalで決定的）。 */
export function multiHouseSupportingIds(): readonly string[] {
  return MULTI_HOUSE_SUPPORTING_COHORTS.flatMap(c =>
    Array.from({ length: c.memberCount }, (_, i) => supportingCandidateId(c.cohortId, i)))
}

export const MULTI_HOUSE_AUTONOMY: AutonomyCalibration = Object.freeze({
  status: 'CALIBRATION_ONLY',
  birth: { minMotherAge: 18, maxMotherAge: 40, minFatherAge: 18, chancePermille: 150 },
  death: { minAge: 1, riskStartAge: 45, basePermille: 4, increasePerYearPermille: 14, maxPermille: 900 },
  marriage: { minAdultAge: 18, maxCandidatePairs: 2400 },
}) as AutonomyCalibration

export const MULTI_HOUSE_NEXTGEN_CONTRACT: NextgenContractCalibration = Object.freeze({
  ...EXPERIMENTAL_NEXTGEN_CONTRACT,
  ownDynastyBonus: 2, otherDynastyCost: 0, titleWeight: 4, noClauseCost: 5, supportWeight: 0,
})

export const MULTI_HOUSE_B009_CALIBRATION = Object.freeze({
  ...EXPERIMENTAL_B009_CALIBRATION,
  initialTrust: 24, initialTrustSpread: 16, annualDelta: 1, houseSupportWeight: 0, sameHouseBonus: 0, maxPairs: 2400,
})

/**
 * 禁親証拠: 人物ペア単位の合成CALIBRATION_ONLY台帳。供給しないペアは B-005/A-LEG-01 が DEFER のまま。
 * 対象は「初期のエルディア重要人物(IDが固定)」×「供給コホートの個別化候補(IDがcohort×ordinalで決定的)」の
 * 異性・異家門ペアのみ。familyPoolId・家門差・親ID欠落は証明ではなく、証拠は台帳の個別記録だけ。
 * 実出生した人物のIDは出生前に列挙できないため、実出生人物×SUPPORTINGのペアには証拠を与えない(DEFER)。
 */
const EVIDENCE_PERSONS = Object.freeze([
  'person-exp-01', 'person-exp-02', 'person-exp-03', 'person-exp-04', 'person-exp-05', 'person-exp-06',
] as const)
const EVIDENCE_WINDOW_YEARS = 30
function buildClearances(): SupportingKinshipClearance[] {
  const world = createExperimentalWorld()
  const out: SupportingKinshipClearance[] = []
  for (const cohort of MULTI_HOUSE_SUPPORTING_COHORTS) {
    for (let ordinal = 0; ordinal < cohort.memberCount; ordinal++) {
      const sid = supportingCandidateId(cohort.cohortId, ordinal)
      for (const pid of EVIDENCE_PERSONS) {
        const p = world.persons.find(x => x.personId === pid)!
        if (p.sex === cohort.sex || p.houseId === cohort.affiliationHouseId) continue
        const checkedYear = Math.max(MULTI_HOUSE_START_YEAR, cohort.birthYear + 18)
        const validUntilYear = Math.min(MULTI_HOUSE_END_YEAR + 1, checkedYear + EVIDENCE_WINDOW_YEARS)
        if (validUntilYear <= checkedYear) continue
        const ids = [pid, sid].sort() as [string, string]
        out.push({
          clearanceId: `multi-house:kinship-check:${JSON.stringify(ids)}`,
          personIds: ids, countryId: 'country-eldia', checkedYear, validUntilYear,
          sourceEvidenceId: `multi-house:person-level-lineage-record:${JSON.stringify(ids)}`,
          provenance: 'CALIBRATION_ONLY',
        })
      }
    }
  }
  return out.sort((a, b) => (a.clearanceId < b.clearanceId ? -1 : a.clearanceId > b.clearanceId ? 1 : 0))
}
/** 明示した初期関係値は無し。新規ペアの初期値はB-009の校正値(initialTrust+決定的な個体差)で与える。 */
export const MULTI_HOUSE_TRUST_BASE: readonly PairTrustBase[] = Object.freeze([]) as readonly PairTrustBase[]

export const MULTI_HOUSE_SUPPORTING_CLEARANCES: readonly SupportingKinshipClearance[] = Object.freeze(buildClearances())

/** C004匿名出生履歴を空から蓄積させる初期世界。重要人物は初期8人のまま増やさない。 */
export function createMultiHouseWorld(): WorldState {
  const w = createExperimentalWorld()
  return { ...w, demographics: { ...w.demographics, anonymousBirthHistory: [] } }
}

export function createMultiHouseEvaluators(startWorld: WorldState, ledger: readonly StatModifier[] = []): EvaluatorMap {
  const trial = createExperimentalOrdinaryLegalTrial()
  const cfg = createAutonomousCalibrationEvaluators({
    branchStartWorld: startWorld, ledger, trustBase: MULTI_HOUSE_TRUST_BASE,
    nextgenMarriage: {
      book: trial.book, laws: trial.laws, calibration: MULTI_HOUSE_NEXTGEN_CONTRACT,
      supportingKinshipClearances: MULTI_HOUSE_SUPPORTING_CLEARANCES,
    },
    reviewedLegal: { book: trial.book, ordinaryLaws: trial.laws },
    spouseDeathDissolution: true,
    supportingMarriage: supportingInput(),
    autonomy: MULTI_HOUSE_AUTONOMY,
    b009Calibration: MULTI_HOUSE_B009_CALIBRATION,
  })
  if (!cfg.ok) throw new Error('INVALID_MULTI_HOUSE_EVALUATORS:' + cfg.issues.join('; '))
  return cfg.evaluators
}

/** 供給コホートと評価器へ渡す入力(評価器factoryとidentityが同じ値を使う)。 */
function supportingInput(): B001SupportingInput {
  return { cohorts: MULTI_HOUSE_SUPPORTING_COHORTS, ...MULTI_HOUSE_SUPPORTING_LIMITS, kinshipClearances: MULTI_HOUSE_SUPPORTING_CLEARANCES }
}

/** 主試遊の実行条件。seedと介入ledgerは構成identityには含めない(A側の別キーで識別する)。 */
export const MULTI_HOUSE_RUN_CONDITIONS = Object.freeze({
  configId: MULTI_HOUSE_CONFIG_ID,
  startYear: MULTI_HOUSE_START_YEAR, endYear: MULTI_HOUSE_END_YEAR,
  primarySeed: MULTI_HOUSE_SEED, extraSeeds: MULTI_HOUSE_EXTRA_SEEDS,
  goal: MULTI_HOUSE_GOAL, technicalGoalEvaluation: true,
})

/**
 * 実行構成identity(読み取り専用, JSON.stringify可能)。createMultiHouseEvaluators が評価器へ渡す法令・証拠・校正・
 * 供給コホート・禁親証拠・信頼基準と、createMultiHouseWorld の初期世界・各ルール版を、同じ定数/関数から都度導出する。
 * 手書きの固定値を持たないため、いずれかが変われば自動的に値が変わる(A0キャッシュの誤再利用を防ぐ)。
 * seed・介入ledger・開始年のWorldStateは含めない。値の変更や計算には関与しない。
 */
export function multiHouseRunConfigIdentity(): Readonly<Record<string, unknown>> {
  const trial = createExperimentalOrdinaryLegalTrial()
  return {
    configId: MULTI_HOUSE_CONFIG_ID,
    world: createMultiHouseWorld(),
    tuning: EXPERIMENTAL_TUNING,
    book: trial.book, laws: trial.laws,
    nextgenContract: MULTI_HOUSE_NEXTGEN_CONTRACT,
    supporting: supportingInput(),
    trustBase: MULTI_HOUSE_TRUST_BASE,
    autonomy: MULTI_HOUSE_AUTONOMY, b009: MULTI_HOUSE_B009_CALIBRATION,
    spouseDeathDissolution: true,
    ruleVersions: {
      b001Supporting: B001_SUPPORTING_VERSION, b002: B002_AUTONOMOUS_VERSION, b003: B003_AUTONOMOUS_VERSION,
      b004: B004_RULE_VERSION, b005: B005_NEXTGEN_VERSION, b009: B009_RULE_VERSION,
      aDyn02: ADYN02_RULE_VERSION, aLeg01: ORDINARY_MARRIAGE_VERSION,
      spouseDeath: SPOUSE_DEATH_DISSOLUTION_VERSION, reviewedLegal: REVIEWED_LEGAL_VERSION,
    },
    runConditions: { startYear: MULTI_HOUSE_START_YEAR, endYear: MULTI_HOUSE_END_YEAR, goal: MULTI_HOUSE_GOAL },
  }
}

/** identityの短い比較用ダイジェスト(FNV-1a 2系統の連結, 暗号用途ではない)。キー順に依存しない正規化JSONから算出。 */
export function multiHouseRunConfigDigest(): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canon(x)]))
        : v
  const text = JSON.stringify(canon(multiHouseRunConfigIdentity()))
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0xdeadbeef
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/** 人物の出所。重要人物(初期8人)・人口由来SUPPORTING・実出生を区別する(全人口はPersonに変換しない)。 */
export type MultiHousePersonOrigin = 'INITIAL_KEY' | 'POPULATION_SUPPORTING' | 'AUTONOMOUS_BIRTH' | 'OTHER'
export type MultiHousePersonRecord = Readonly<{
  personId: Id
  origin: MultiHousePersonOrigin
  sex: 'MALE' | 'FEMALE'
  birthYear: number
  alive: boolean
  houseId: Id
  originGroupId: Id
  legalDynasty: WorldState['persons'][number]['legalDynasty']
  fatherId: Id | null
  motherId: Id | null
  /** SUPPORTINGのみ: 人口コホートと出典(C004出生出典・生存確認・初期台帳は別ID)。 */
  population: Readonly<{ cohortId: Id; memberOrdinal: number; birthBacking: 'INITIAL_POPULATION' | 'C004_COHORT'
    sourceEvidenceId: Id; survivorAttestationId: Id | null; familyPoolId: Id }> | null
}>

const INITIAL_KEY_IDS: ReadonlySet<Id> = new Set(createExperimentalWorld().persons.map(p => p.personId))

/** WorldStateの人物を、stable ID・家門・法的王朝・親子・出身集団・出典つきの事実データへ整理する(表示名は含めない)。 */
export function multiHousePersonRecords(world: WorldState): readonly MultiHousePersonRecord[] {
  const cohortOf = new Map<Id, SupportingMarriageCohort>()
  for (const c of MULTI_HOUSE_SUPPORTING_COHORTS) {
    for (let i = 0; i < c.memberCount; i++) cohortOf.set(supportingCandidateId(c.cohortId, i), c)
  }
  return world.persons.map((p): MultiHousePersonRecord => {
    const cohort = cohortOf.get(p.personId)
    const origin: MultiHousePersonOrigin = INITIAL_KEY_IDS.has(p.personId) ? 'INITIAL_KEY'
      : cohort && p.interactionRole === 'SUPPORTING' ? 'POPULATION_SUPPORTING'
        : p.fatherId !== undefined || p.motherId !== undefined ? 'AUTONOMOUS_BIRTH' : 'OTHER'
    return {
      personId: p.personId, origin, sex: p.sex, birthYear: p.birthYear, alive: p.alive,
      houseId: p.houseId, originGroupId: p.originGroupId, legalDynasty: p.legalDynasty,
      fatherId: p.fatherId ?? null, motherId: p.motherId ?? null,
      population: origin === 'POPULATION_SUPPORTING' && cohort ? {
        cohortId: cohort.cohortId, memberOrdinal: Number(JSON.parse(p.personId.slice('support:population:'.length))[1]),
        birthBacking: cohort.source, sourceEvidenceId: cohort.sourceEvidenceId,
        survivorAttestationId: cohort.survivorAttestationId ?? null, familyPoolId: cohort.familyPoolId,
      } : null,
    }
  })
}

export const MULTI_HOUSE_PROVENANCE: readonly ProvenanceEntry[] = Object.freeze([
  { subject: '複数家門試遊構成(初期8人+人口由来SUPPORTING+自律出生)', origin: 'PLACEHOLDER',
    source: 'docs/decisions DEC-057/058/061, Issue #114',
    note: 'CALIBRATION_ONLY。供給コホート・禁親証拠台帳・校正係数は試験値。婚姻/出生/死亡/王朝所属/相続の成立を予約せず、正式世界設定・Goal達成を示さない。' },
  { subject: '子の家門(母のhouseId継承)', origin: 'PLACEHOLDER', source: 'src/simulation/rules/b/b002-worldstate.ts',
    note: 'B-002のCALIBRATION_ONLY実装であり、一般的な家門継承法として採用していない。' },
])
