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
const DYNASTY_KEY_HEAD = 'CHILD_DYNASTY:'

/** Aが発行した正規の契約ID・王朝条項ID（prefix + JSON [年, ペア, キー]）を完全に再構成できる場合だけ契約案キーを返す。 */
function canonicalNextgenKey(id: string, prefix: 'contract:nextgen:' | 'clause:nextgen:'): string | null {
  if (!id.startsWith(prefix)) return null
  let v: unknown
  try { v = JSON.parse(id.slice(prefix.length)) } catch { return null }
  if (!Array.isArray(v) || v.length !== 3 || !Number.isSafeInteger(v[0]) || !Array.isArray(v[1]) || v[1].length !== 2 ||
      !v[1].every((p) => typeof p === 'string') || typeof v[2] !== 'string') return null
  return prefix + JSON.stringify(v) === id ? v[2] : null
}

/**
 * 正規の契約ID・王朝条項IDのキーが、与えた王朝案（契約に現存する王朝条項の実dynastyId、nullは王朝条項なし）の
 * 母方案 nextgenContractKey(dynastyId, houseId) であれば、その家門IDを読む。
 * 王朝IDは任意の非空文字列のため、キーを区切り文字で分割して王朝IDを推測しない。
 * 父方案 nextgenContractKey(dynastyId) と一致する場合（王朝ID自体が区切りを含む旧契約を含む）、旧契約・任意IDは null。
 */
export function nextgenDeclaredChildHouseId(
  id: string, prefix: 'contract:nextgen:' | 'clause:nextgen:', dynastyId: Id | null,
): Id | null {
  if (dynastyId === '') return null
  const key = canonicalNextgenKey(id, prefix)
  if (key === null) return null
  const head = nextgenContractKey(dynastyId) + HOUSE_KEY_MARK
  if (!key.startsWith(head)) return null
  const houseId = key.slice(head.length)
  return houseId !== '' && nextgenContractKey(dynastyId, houseId) === key ? houseId : null
}

/**
 * 王朝条項が1件も無い契約で、正規の契約IDが王朝案かつ家門区切りを含むか。
 * Aの生成式では王朝案のキーには必ず王朝条項が付くため、これは現存条項から再構成できない記録であり、
 * 王朝IDをどう読んでも母方案を除外できない（旧有効契約はこの形にならない）。
 */
export function nextgenUnanchoredDynastyHouseKey(id: string): boolean {
  const key = canonicalNextgenKey(id, 'contract:nextgen:')
  if (key === null || !key.startsWith(DYNASTY_KEY_HEAD)) return false
  for (let at = key.indexOf(HOUSE_KEY_MARK, DYNASTY_KEY_HEAD.length + 1); at >= 0; at = key.indexOf(HOUSE_KEY_MARK, at + 1)) {
    if (at + HOUSE_KEY_MARK.length < key.length) return true
  }
  return false
}
