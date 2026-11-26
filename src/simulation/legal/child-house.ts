// DEC-190: 出生児の家門所属（houseId）を父方原則と婚姻契約の明示的な母方例外から決める。
// 法的王朝（CHILD_LEGAL_DYNASTY）・実親子・出身人口集団（originGroupId）とは独立に扱い、相互に代用しない。
// 例外は婚姻当事者である母の実在家門で、父の家門と異なり同じ国家管轄にある場合だけ。不正・不足は保留し、父方へ暗黙にfallbackしない。
import type { ChildHouseAffiliationClause, Id, Marriage, MarriageContract, Person, WorldState } from '../contracts/index.ts'

export const CHILD_HOUSE_AFFILIATION_VERSION = 'dec190-child-house-affiliation-0'

export type ChildHouseResolution =
  | Readonly<{ status: 'RESOLVED'; houseId: Id; basis: 'PATERNAL_DEFAULT'; clauseId: null }>
  | Readonly<{ status: 'RESOLVED'; houseId: Id; basis: 'MATERNAL_CONTRACT_CLAUSE'; clauseId: Id }>
  | Readonly<{ status: 'UNRESOLVED'; reasonCode: string }>

const present = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export const childHouseClauses = (contract: MarriageContract | undefined): readonly ChildHouseAffiliationClause[] =>
  contract?.clauses.filter((c): c is ChildHouseAffiliationClause => c.kind === 'CHILD_HOUSE_AFFILIATION') ?? []

/**
 * 当事者の現在の記録に照らした家門条項の適格性。婚姻登録時と出生時に同じ基準で使う。
 * 父方と同じ家門の重複案、第三者・未知の家門、当事者以外・父を出典とする条項、管轄外の家門は不適格。
 */
export function childHouseClauseIssue(
  world: WorldState, parties: readonly [Person, Person], clause: ChildHouseAffiliationClause,
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

/** 契約全体の家門条項の検証。0件は父方原則のため妥当、2件以上は優先順位を自動決定せず不適格。 */
export function childHouseContractIssue(
  world: WorldState, parties: readonly [Person, Person], contract: MarriageContract | undefined,
): string | null {
  const clauses = childHouseClauses(contract)
  if (clauses.length === 0) return null
  if (clauses.length > 1) return 'AMBIGUOUS_CHILD_HOUSE_CLAUSES'
  return childHouseClauseIssue(world, parties, clauses[0]!)
}

/**
 * 登録済みで有効な父母の婚姻から出生児の家門を決める。呼出側が当年の婚姻（ACTIVE・登録年）を確認済みであること。
 * 無条項は父の実在家門。条項は登録済み契約の証拠ID・契約IDを要し、不足・不正はUNRESOLVED。
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
    return world.houses.some((h) => h.houseId === father.houseId)
      ? { status: 'RESOLVED', houseId: father.houseId, basis: 'PATERNAL_DEFAULT', clauseId: null }
      : { status: 'UNRESOLVED', reasonCode: 'PATERNAL_HOUSE_UNKNOWN' }
  }
  const contract = marriage.contract!
  if (!present(contract.contractId) || !present(contract.evidenceId)) return { status: 'UNRESOLVED', reasonCode: 'MARRIAGE_CONTRACT_EVIDENCE_MISSING' }
  const issue = childHouseContractIssue(world, [father, mother], contract)
  if (issue) return { status: 'UNRESOLVED', reasonCode: issue }
  const clause = clauses[0]!
  return { status: 'RESOLVED', houseId: clause.houseId, basis: 'MATERNAL_CONTRACT_CLAUSE', clauseId: clause.clauseId }
}
