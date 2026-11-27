// DEC-190: 出生児の家門所属（houseId）を父方原則と婚姻契約の明示的な母方例外から決める。
// 法的王朝（CHILD_LEGAL_DYNASTY）・実親子・出身人口集団（originGroupId）とは独立に扱い、相互に代用しない。
// 例外は婚姻当事者である母の実在家門で、父の家門と異なり同じ国家管轄にある場合だけ。不正・不足は保留し、父方へ暗黙にfallbackしない。
import type {
  ChildHouseAffiliationClause, DecisionTrace, Id, Marriage, MarriageContract, Person, WorldState, Year,
} from '../contracts/index.ts'
import { canonicalize } from '../engine/reducer/canonical.ts'
import { nextgenContractKey, nextgenDeclaredChildHouseId, nextgenMarriageContract } from './nextgen-contract-ids.ts'

/**
 * 1: 母方家門条項に登録時の双方合意の記録を保存し、出生時に契約全体との結合を照合する。
 * 2: 正規の契約ID・王朝条項IDが母方案を示すのに家門条項が無い契約を父方原則とせず保留する。
 */
export const CHILD_HOUSE_AFFILIATION_VERSION = 'dec190-child-house-affiliation-2'

export type ChildHouseResolution =
  | Readonly<{ status: 'RESOLVED'; houseId: Id; basis: 'PATERNAL_DEFAULT'; clauseId: null }>
  | Readonly<{ status: 'RESOLVED'; houseId: Id; basis: 'MATERNAL_CONTRACT_CLAUSE'; clauseId: Id }>
  | Readonly<{ status: 'UNRESOLVED'; reasonCode: string }>

const present = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export const childHouseClauses = (contract: MarriageContract | undefined): readonly ChildHouseAffiliationClause[] =>
  contract?.clauses.filter((c): c is ChildHouseAffiliationClause => c.kind === 'CHILD_HOUSE_AFFILIATION') ?? []

/**
 * 家門条項が0件でも、Aが発行した正規の契約ID・王朝条項IDが母方案を示す場合は条項の欠落（記録間の矛盾）。
 * 生成式で再構成できるIDだけを読むため、旧契約・任意IDの無条項契約は従来どおり父方原則。
 */
export function childHouseClauseMissingIssue(contract: MarriageContract | undefined): string | null {
  if (!contract || childHouseClauses(contract).length > 0) return null
  const declared = [
    present(contract.contractId) ? nextgenDeclaredChildHouseId(contract.contractId, 'contract:nextgen:') : null,
    ...contract.clauses.map((c) => c.kind === 'CHILD_LEGAL_DYNASTY' && present(c.clauseId)
      ? nextgenDeclaredChildHouseId(c.clauseId, 'clause:nextgen:') : null),
  ]
  return declared.some((h) => h !== null) ? 'CHILD_HOUSE_CLAUSE_MISSING' : null
}

/** 子の家門を契約から決める婚姻か（家門条項がある、または正規IDが条項を示す）。reducer の出生照合に使う。 */
export const childHouseGovernedByContract = (contract: MarriageContract | undefined): boolean =>
  childHouseClauses(contract).length > 0 || childHouseClauseMissingIssue(contract) !== null

/**
 * 当事者の現在の記録に照らした家門条項の適格性。婚姻登録時と出生時に同じ基準で使う。
 * 父方と同じ家門の重複案、第三者・未知の家門、当事者以外・父を出典とする条項、管轄外の家門は不適格。
 */
export function childHouseClauseIssue(
  world: WorldState, parties: readonly [Person, Person],
  clause: Pick<ChildHouseAffiliationClause, 'clauseId' | 'houseId' | 'sourcePersonId'>,
): string | null {
  if (!present(clause.clauseId) || !present(clause.houseId) || !present(clause.sourcePersonId)) return 'CHILD_HOUSE_CLAUSE_ID_MISSING'
  const mother = parties.find((p) => p.sex === 'FEMALE')
  const father = parties.find((p) => p.sex === 'MALE')
  if (!mother || !father) return 'CHILD_HOUSE_PARENT_ROLE_MISMATCH'
  if (clause.sourcePersonId !== mother.personId) return 'CHILD_HOUSE_SOURCE_NOT_MOTHER'
  if (clause.houseId !== mother.houseId) return 'CHILD_HOUSE_NOT_MATERNAL_HOUSE'
  if (clause.houseId === father.houseId) return 'CHILD_HOUSE_CLAUSE_REDUNDANT_PATERNAL'
  const house = world.houses.find((h) => h.houseId === clause.houseId)
  const paternal = world.houses.find((h) => h.houseId === father.houseId)
  if (!house || !paternal) return 'CHILD_HOUSE_UNKNOWN'
  if (!present(house.countryId) || house.countryId !== paternal.countryId) return 'CHILD_HOUSE_JURISDICTION_MISMATCH'
  return null
}

/** 契約全体の家門条項の検証。0件は父方原則のため妥当（正規IDが条項を示す欠落を除く）、2件以上は優先順位を自動決定せず不適格。 */
export function childHouseContractIssue(
  world: WorldState, parties: readonly [Person, Person], contract: MarriageContract | undefined,
): string | null {
  const clauses = childHouseClauses(contract)
  if (clauses.length === 0) return childHouseClauseMissingIssue(contract)
  if (clauses.length > 1) return 'AMBIGUOUS_CHILD_HOUSE_CLAUSES'
  return childHouseClauseIssue(world, parties, clauses[0]!)
}

/**
 * 家門条項に保存された双方合意の記録と契約全体の結合。登録時（reducer）と出生時に WorldState だけで照合する。
 * 記録の当事者・年が婚姻と一致し、双方の得点が閾値以上で、記録から再構成した A の発行契約
 * （契約ID・証拠ID・全条項）が保存済み契約と完全に一致する場合だけ妥当。
 * 父方案の契約への後付け、条項の改変、別契約・別ペア・別年の記録の流用は不一致になる。
 */
export function childHouseAgreementIssue(
  marriage: Pick<Marriage, 'registeredYear' | 'personIds'>, contract: MarriageContract | undefined,
): string | null {
  const clauses = childHouseClauses(contract)
  if (clauses.length === 0) return childHouseClauseMissingIssue(contract)
  if (clauses.length > 1) return 'AMBIGUOUS_CHILD_HOUSE_CLAUSES'
  const clause = clauses[0]!, a = clause.agreement
  if (a === null || typeof a !== 'object') return 'CHILD_HOUSE_AGREEMENT_MISSING'
  if (a.registeredYear !== marriage.registeredYear || !Array.isArray(a.personIds) ||
      a.personIds[0] !== marriage.personIds[0] || a.personIds[1] !== marriage.personIds[1]) {
    return 'CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH'
  }
  const scores = [a.firstConsentScore, a.secondConsentScore, a.consentThreshold]
  if (!scores.every(Number.isSafeInteger) || a.firstConsentScore < a.consentThreshold || a.secondConsentScore < a.consentThreshold) {
    return 'CHILD_HOUSE_AGREEMENT_CONSENT_MISSING'
  }
  if (!present(a.sourceTraceId) || a.contractKey !== nextgenContractKey(a.dynastyId ?? null, clause.houseId)) {
    return 'CHILD_HOUSE_AGREEMENT_KEY_MISMATCH'
  }
  const issued = nextgenMarriageContract(a.registeredYear, a.personIds, a.contractKey, a.dynastyId ?? null,
    { houseId: clause.houseId, sourcePersonId: clause.sourcePersonId, agreement: a }, a.sourceTraceId)
  return canonicalize(issued) === canonicalize(contract) ? null : 'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'
}

/**
 * A-LEG-01 の登録時審査。当事者の適格性・合意記録の結合に加え、記録が指す当年の B-005 ACCEPT Trace の
 * 選択案・家門・双方の得点が記録と一致することを確認する。手動の候補・承認記録だけでは家門条項を登録しない。
 */
export function childHouseRegistrationIssue(
  world: WorldState, year: Year, pair: readonly [Id, Id], parties: readonly [Person, Person],
  contract: MarriageContract | undefined, priorTraces: readonly DecisionTrace[],
): string | null {
  const clauses = childHouseClauses(contract)
  if (clauses.length === 0) return childHouseClauseMissingIssue(contract)
  const issue = childHouseContractIssue(world, parties, contract) ?? childHouseAgreementIssue({ registeredYear: year, personIds: pair }, contract)
  if (issue) return issue
  const clause = clauses[0]!, a = clause.agreement
  const traces = priorTraces.filter((t) => t.traceId === a.sourceTraceId)
  const t = traces.length === 1 ? traces[0]! : undefined
  if (!t || t.ruleId !== 'B-005' || t.year !== year || t.phase !== 3 || t.status !== 'ACCEPT' ||
      t.actorRef.kind !== 'PERSON_PAIR' || [...t.actorRef.ids].sort().join('\u0000') !== [...pair].sort().join('\u0000') ||
      t.candidates.length !== 1 || t.selectedCandidateId !== t.candidates[0]!.candidateId) {
    return 'CHILD_HOUSE_AGREEMENT_TRACE_MISSING'
  }
  const inputs = t.candidates[0]!.inputs
  const options = Array.isArray(inputs.contractOptions) ? inputs.contractOptions : []
  const chosen = options.filter((o) => o !== null && typeof o === 'object' && !Array.isArray(o) &&
    (o as Readonly<Record<string, unknown>>).key === a.contractKey) as Readonly<Record<string, unknown>>[]
  const house = { basis: 'MATERNAL_CONTRACT_CLAUSE', houseId: clause.houseId, sourcePersonId: clause.sourcePersonId }
  if (inputs.selectedContractKey !== a.contractKey || canonicalize(inputs.selectedChildHouse) !== canonicalize(house) ||
      chosen.length !== 1 || chosen[0]!.mutuallyAccepted !== true || (chosen[0]!.dynastyId ?? null) !== (a.dynastyId ?? null) ||
      canonicalize(chosen[0]!.childHouse) !== canonicalize(house) ||
      chosen[0]!.firstConsentScore !== a.firstConsentScore || chosen[0]!.secondConsentScore !== a.secondConsentScore) {
    return 'CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH'
  }
  return null
}

/**
 * 登録済みで有効な父母の婚姻から出生児の家門を決める。呼出側が当年の婚姻（ACTIVE・登録年）を確認済みであること。
 * 無条項は父の実在家門（正規IDが母方案を示す条項欠落は保留）。条項は登録時の双方合意の記録と契約全体が結合していることを要し、不足・不正はUNRESOLVED。
 */
export function resolveChildHouseAffiliation(
  world: WorldState, father: Person, mother: Person, marriage: Marriage,
): ChildHouseResolution {
  if (father.sex !== 'MALE' || mother.sex !== 'FEMALE' ||
      !marriage.personIds.includes(father.personId) || !marriage.personIds.includes(mother.personId)) {
    return { status: 'UNRESOLVED', reasonCode: 'CHILD_HOUSE_PARENT_ROLE_MISMATCH' }
  }
  const clauses = childHouseClauses(marriage.contract)
  if (clauses.length === 0) {
    const missing = childHouseClauseMissingIssue(marriage.contract)
    if (missing) return { status: 'UNRESOLVED', reasonCode: missing }
    return world.houses.some((h) => h.houseId === father.houseId)
      ? { status: 'RESOLVED', houseId: father.houseId, basis: 'PATERNAL_DEFAULT', clauseId: null }
      : { status: 'UNRESOLVED', reasonCode: 'PATERNAL_HOUSE_UNKNOWN' }
  }
  const contract = marriage.contract!
  if (!present(contract.contractId) || !present(contract.evidenceId)) return { status: 'UNRESOLVED', reasonCode: 'MARRIAGE_CONTRACT_EVIDENCE_MISSING' }
  const issue = childHouseContractIssue(world, [father, mother], contract) ?? childHouseAgreementIssue(marriage, contract)
  if (issue) return { status: 'UNRESOLVED', reasonCode: issue }
  const clause = clauses[0]!
  return { status: 'RESOLVED', houseId: clause.houseId, basis: 'MATERNAL_CONTRACT_CLAUSE', clauseId: clause.clauseId }
}
