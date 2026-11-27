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

const HOUSE_KEY_MARK = '+CHILD_HOUSE:'

/**
 * Aが発行した正規の契約ID・王朝条項IDに含まれる契約案キーから、母方家門条項を示す家門IDを読む。
 * 生成式（JSON [年, ペア, キー] と nextgenContractKey）で完全に再構成できる場合だけ読み、旧契約や任意のIDは null。
 */
export function nextgenDeclaredChildHouseId(id: string, prefix: 'contract:nextgen:' | 'clause:nextgen:'): Id | null {
  if (!id.startsWith(prefix)) return null
  let v: unknown
  try { v = JSON.parse(id.slice(prefix.length)) } catch { return null }
  if (!Array.isArray(v) || v.length !== 3 || !Number.isSafeInteger(v[0]) || !Array.isArray(v[1]) || v[1].length !== 2 ||
      !v[1].every((p) => typeof p === 'string') || typeof v[2] !== 'string') return null
  const key = v[2], at = key.indexOf(HOUSE_KEY_MARK)
  if (at < 0) return null
  const head = key.slice(0, at), houseId = key.slice(at + HOUSE_KEY_MARK.length)
  const dynastyId = head === 'NO_CLAUSE' ? null : head.startsWith('CHILD_DYNASTY:') ? head.slice('CHILD_DYNASTY:'.length) : undefined
  if (dynastyId === undefined || dynastyId === '' || houseId === '') return null
  if (prefix + JSON.stringify(v) !== id || nextgenContractKey(dynastyId, houseId) !== key) return null
  return houseId
}
