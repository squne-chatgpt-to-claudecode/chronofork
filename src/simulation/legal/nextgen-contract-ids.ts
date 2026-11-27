// DEC-058/190: A-LEG-01が当年の合意から発行する婚姻契約のIDと条項の正規形。
// 交渉（nextgen-contract）と出生時の照合（child-house）が同じ式を使い、登録後の後付け・改変を検出する。
import type { ChildHouseAgreementRecord, Id, MarriageClause, MarriageContract, Year } from '../contracts/index.ts'

/** 契約案のキー。王朝条項なしはNO_CLAUSE、母方家門条項は末尾に付す。 */
export const nextgenContractKey = (dynastyId: Id | null, childHouseId?: Id): string =>
  (dynastyId === null ? 'NO_CLAUSE' : 'CHILD_DYNASTY:' + dynastyId) +
  (childHouseId === undefined ? '' : '+CHILD_HOUSE:' + childHouseId)

export type NextgenContractHouse = Readonly<{ houseId: Id; sourcePersonId: Id; agreement: ChildHouseAgreementRecord }>

export function nextgenMarriageContract(
  year: Year, pair: readonly [Id, Id], contractKey: string, dynastyId: Id | null,
  house: NextgenContractHouse | undefined, sourceTraceId: Id,
): MarriageContract {
  const key = JSON.stringify([year, pair, contractKey])
  const clauses: MarriageClause[] = dynastyId === null ? [] : [{
    clauseId: 'clause:nextgen:' + key, kind: 'CHILD_LEGAL_DYNASTY', dynastyId,
  }]
  if (house) clauses.push({ clauseId: 'clause:nextgen-house:' + key, kind: 'CHILD_HOUSE_AFFILIATION',
    houseId: house.houseId, sourcePersonId: house.sourcePersonId, agreement: house.agreement })
  return { contractId: 'contract:nextgen:' + key, evidenceId: 'evidence:nextgen-agreement:' + sourceTraceId, clauses }
}
