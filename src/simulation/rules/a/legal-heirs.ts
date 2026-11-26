// G-03/04 を使う土地相続候補の純粋な順位照合（CALIBRATION_ONLY）。
// 明示された親子関係・生死・法的王朝所属だけを使用し、婚外の合法性や権限を補完しない。
import type { Id, Person, WorldState } from '../../contracts/index.ts'

export type HeirReview =
  | Readonly<{ status: 'READY'; personId: Id; rankedCandidateIds: readonly Id[]; relation: 'DESCENDANT' | 'COLLATERAL' }>
  | Readonly<{ status: 'PENDING'; reasonCodes: readonly string[]; rankedCandidateIds: readonly Id[] }>

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const childrenOf = (persons: readonly Person[], parentId: Id): Person[] =>
  persons.filter(p => p.fatherId === parentId || p.motherId === parentId)
    .sort((a, b) => (a.sex === b.sex ? 0 : a.sex === 'MALE' ? -1 : 1) ||
      a.birthYear - b.birthYear || cmp(a.personId, b.personId))

/** 年長枝を先に辿る。死亡した上位枝は代襲を評価し、年齢等の未承認適格性を推測しない。 */
export function reviewLandHeir(world: WorldState, predecessorId: Id): HeirReview {
  const byId = new Map(world.persons.map(p => [p.personId, p]))
  const predecessor = byId.get(predecessorId)
  if (!predecessor || predecessor.alive) {
    return { status: 'PENDING', reasonCodes: ['PREDECESSOR_NOT_DECEASED'], rankedCandidateIds: [] }
  }
  const ranked: Id[] = []
  const seen = new Set<Id>()
  let unresolved: string | null = null
  const fromBranch = (id: Id): Person | undefined => {
    if (seen.has(id)) { unresolved = 'KINSHIP_CYCLE'; return undefined }
    seen.add(id)
    const p = byId.get(id)
    if (!p) { unresolved = 'PERSON_NOT_FOUND'; return undefined }
    ranked.push(p.personId)
    if (p.alive) {
      if (p.legalDynasty.status !== 'DETERMINED') { unresolved = 'LEGAL_DYNASTY_UNDETERMINED'; return undefined }
      return p
    }
    return visitChildren(p.personId)
  }
  const visitChildren = (parent: Id): Person | undefined => {
    const kids = childrenOf(world.persons, parent)
    for (let i = 1; i < kids.length; i++) {
      if (kids[i]!.sex === kids[i-1]!.sex && kids[i]!.birthYear === kids[i-1]!.birthYear) {
        unresolved = 'SAME_PRIORITY_BIRTH_YEAR'
        return undefined
      }
    }
    for (const child of kids) {
      const heir = fromBranch(child.personId)
      if (unresolved || heir) return heir
    }
    return undefined
  }
  const descendant = visitChildren(predecessorId)
  if (unresolved) return { status: 'PENDING', reasonCodes: [unresolved], rankedCandidateIds: ranked }
  if (descendant) return { status: 'READY', personId: descendant.personId, rankedCandidateIds: ranked, relation: 'DESCENDANT' }
  // 近い祖先の明示された同胞枝に限って傍系を探す。祖先情報不足なら勝手に補完しない。
  const parentIds = [predecessor.fatherId, predecessor.motherId].filter((id): id is Id => !!id)
  if (parentIds.length === 0) return { status: 'PENDING', reasonCodes: ['COLLATERAL_PARENTAGE_UNDETERMINED'], rankedCandidateIds: ranked }
  const siblings = [...new Map(parentIds.flatMap(id => childrenOf(world.persons, id))
    .filter(p => p.personId !== predecessorId).map(p => [p.personId, p])).values()]
    .sort((a, b) => (a.sex === b.sex ? 0 : a.sex === 'MALE' ? -1 : 1) ||
      a.birthYear - b.birthYear || cmp(a.personId, b.personId))
  for (let i = 1; i < siblings.length; i++) {
    if (siblings[i]!.sex === siblings[i-1]!.sex && siblings[i]!.birthYear === siblings[i-1]!.birthYear) {
      return { status: 'PENDING', reasonCodes: ['SAME_PRIORITY_BIRTH_YEAR'], rankedCandidateIds: ranked }
    }
  }
  for (const s of siblings) {
    const heir = fromBranch(s.personId)
    if (unresolved) return { status: 'PENDING', reasonCodes: [unresolved], rankedCandidateIds: ranked }
    if (heir) return { status: 'READY', personId: heir.personId, rankedCandidateIds: ranked, relation: 'COLLATERAL' }
  }
  return { status: 'PENDING', reasonCodes: ['NO_ESTABLISHED_HEIR'], rankedCandidateIds: ranked }
}

// DEC-189 / MVP§8.5: 直系・同胞枝で確立しない場合だけ、記録済みの近い共通祖先へ段階的に遡る。
// 旧reviewLandHeirは既存構成の再現性のため変更しない。選択は評価器構成の明示オプトイン。
export const ANCESTRAL_HEIR_SEARCH_VERSION = 'dec189-recorded-common-ancestor-1:CALIBRATION_ONLY'
export type HeirSearchMode = 'SIBLING_BRANCH' | 'RECORDED_COMMON_ANCESTOR'
export const HEIR_SEARCH_MODES: readonly HeirSearchMode[] = ['SIBLING_BRANCH', 'RECORDED_COMMON_ANCESTOR']

/** 探索の段階。0=直系子孫、1=父母（同胞枝）、2=祖父母、3=曾祖父母…。 */
export type HeirSearchStep = Readonly<{
  depth: number
  commonAncestorIds: readonly Id[]
  branchHeadIds: readonly Id[]
}>
export type HeirSearchDetail = Readonly<{
  version: typeof ANCESTRAL_HEIR_SEARCH_VERSION
  /** 結論を出した段階。候補不在で探索し尽くした場合はnull。 */
  decisiveDepth: number | null
  steps: readonly HeirSearchStep[]
  /** 順位順に審査した人物と結果（死亡枝は代襲として子孫へ進む）。 */
  reviewed: readonly Readonly<{ personId: Id; depth: number; outcome: 'SELECTED' | 'DECEASED_REPRESENTATION' | 'LEGAL_DYNASTY_UNDETERMINED' }>[]
  /** 候補にしない人物。祖先自身と複数経路の再出現を区別する（前保持者本人は記録しない）。 */
  excluded: readonly Readonly<{ personId: Id; depth: number; reason: 'ANCESTOR_OF_PREDECESSOR' | 'DUPLICATE_PATH' }>[]
}>
export type AncestralHeirReview = HeirReview & Readonly<{ search: HeirSearchDetail }>

const byPriority = (a: Person, b: Person) => (a.sex === b.sex ? 0 : a.sex === 'MALE' ? -1 : 1) ||
  a.birthYear - b.birthYear || cmp(a.personId, b.personId)
const samePriority = (sorted: readonly Person[]) => sorted.some((p, i) =>
  i > 0 && p.sex === sorted[i-1]!.sex && p.birthYear === sorted[i-1]!.birthYear)

/**
 * 各段階では、その段階の祖先全員（父方・母方）の未探索の子を旧同胞規則と同じく
 * 男子優先・年長順に並べ、各枝を代襲で辿る。同順位・上位候補の資格未確定・記録欠落・循環は保留。
 */
export function reviewAncestralHeir(world: WorldState, predecessorId: Id): AncestralHeirReview {
  const byId = new Map(world.persons.map(p => [p.personId, p]))
  const kids = new Map<Id, Person[]>()
  for (const p of world.persons) {
    for (const parent of new Set([p.fatherId, p.motherId].filter((id): id is Id => !!id))) {
      const list = kids.get(parent) ?? []
      list.push(p)
      kids.set(parent, list)
    }
  }
  const childrenOfId = (id: Id) => [...(kids.get(id) ?? [])].sort(byPriority)
  const steps: HeirSearchStep[] = []
  const reviewed: { personId: Id; depth: number; outcome: HeirSearchDetail['reviewed'][number]['outcome'] }[] = []
  const excluded: { personId: Id; depth: number; reason: HeirSearchDetail['excluded'][number]['reason'] }[] = []
  const ranked: Id[] = []
  const done = (r: HeirReview, decisiveDepth: number | null): AncestralHeirReview => ({
    ...r, search: { version: ANCESTRAL_HEIR_SEARCH_VERSION, decisiveDepth, steps, reviewed, excluded },
  })
  const pending = (code: string, depth: number | null, extra: readonly string[] = []) =>
    done({ status: 'PENDING', reasonCodes: [code, ...extra], rankedCandidateIds: ranked }, depth)
  const predecessor = byId.get(predecessorId)
  if (!predecessor || predecessor.alive) return pending('PREDECESSOR_NOT_DECEASED', null)

  // 祖先を最短段階で記録する。真の循環（自分の祖先に自分が現れる）は複数経路と区別して保留。
  const ancestorDepth = new Map<Id, number>()
  const missingAncestorDepths: number[] = []
  let cycle = false
  const state = new Map<Id, 'OPEN' | 'CLOSED'>()
  const walk = (id: Id) => {
    if (state.get(id) === 'OPEN') { cycle = true; return }
    if (state.get(id) === 'CLOSED' || cycle) return
    state.set(id, 'OPEN')
    const p = byId.get(id)
    for (const parent of p ? [p.fatherId, p.motherId] : []) if (parent) walk(parent)
    state.set(id, 'CLOSED')
  }
  walk(predecessorId)
  let frontier: Id[] = [predecessorId]
  for (let depth = 1; frontier.length > 0 && !cycle; depth++) {
    const next: Id[] = []
    for (const id of frontier) {
      const p = byId.get(id)
      if (!p) { missingAncestorDepths.push(depth - 1); continue }
      for (const parent of [p.fatherId, p.motherId]) {
        if (!parent || parent === predecessorId || ancestorDepth.has(parent)) continue
        ancestorDepth.set(parent, depth)
        next.push(parent)
      }
    }
    frontier = next
  }

  const visited = new Set<Id>([predecessorId])
  // 代襲で辿っている死亡者の経路。子孫側に経路上の人物が再出現すれば真の循環。
  const onPath = new Set<Id>()
  let unresolved: string | null = null
  // 未探索の子を順位順に並べ、除外理由を記録する。同順位は旧規則どおり一意に定まらないとして保留。
  const heads = (candidates: readonly Person[], depth: number): Person[] | undefined => {
    const open: Person[] = []
    for (const p of [...new Map(candidates.map(c => [c.personId, c])).values()].sort(byPriority)) {
      if (onPath.has(p.personId)) { unresolved = 'KINSHIP_CYCLE'; return undefined }
      if (p.personId === predecessorId) continue
      const reason = ancestorDepth.has(p.personId) ? 'ANCESTOR_OF_PREDECESSOR' as const
        : visited.has(p.personId) ? 'DUPLICATE_PATH' as const : null
      if (reason) { excluded.push({ personId: p.personId, depth, reason }); continue }
      open.push(p)
    }
    if (samePriority(open)) { unresolved = 'SAME_PRIORITY_BIRTH_YEAR'; return undefined }
    return open
  }
  const branch = (p: Person, depth: number): Person | undefined => {
    visited.add(p.personId)
    ranked.push(p.personId)
    if (p.alive) {
      if (p.legalDynasty.status !== 'DETERMINED') {
        reviewed.push({ personId: p.personId, depth, outcome: 'LEGAL_DYNASTY_UNDETERMINED' })
        unresolved = 'LEGAL_DYNASTY_UNDETERMINED'
        return undefined
      }
      reviewed.push({ personId: p.personId, depth, outcome: 'SELECTED' })
      return p
    }
    reviewed.push({ personId: p.personId, depth, outcome: 'DECEASED_REPRESENTATION' })
    onPath.add(p.personId)
    const heir = branches(childrenOfId(p.personId), depth)
    onPath.delete(p.personId)
    return heir
  }
  const branches = (candidates: readonly Person[], depth: number): Person | undefined => {
    const open = heads(candidates, depth)
    for (const p of open ?? []) {
      // 上位候補の重複は先の経路で審査済み。順位の低い経路で再評価しない。
      if (visited.has(p.personId)) { excluded.push({ personId: p.personId, depth, reason: 'DUPLICATE_PATH' }); continue }
      const heir = branch(p, depth)
      if (unresolved || heir) return heir
    }
    return undefined
  }

  const directKids = childrenOfId(predecessorId)
  steps.push({ depth: 0, commonAncestorIds: [], branchHeadIds: directKids.map(p => p.personId) })
  onPath.add(predecessorId)
  const descendant = branches(directKids, 0)
  onPath.delete(predecessorId)
  if (unresolved) return pending(unresolved, 0)
  if (descendant) return done({ status: 'READY', personId: descendant.personId, rankedCandidateIds: ranked, relation: 'DESCENDANT' }, 0)
  if (cycle) return pending('KINSHIP_CYCLE', null)
  if (![predecessor.fatherId, predecessor.motherId].some(Boolean)) return pending('COLLATERAL_PARENTAGE_UNDETERMINED', null)
  const maxDepth = Math.max(0, ...ancestorDepth.values())
  for (let depth = 1; depth <= maxDepth; depth++) {
    // 前段階の祖先記録が欠けると、この段階の祖先・枝の全体が不明になる。
    if (missingAncestorDepths.some(d => d < depth)) return pending('ANCESTOR_RECORD_MISSING', depth)
    const commonAncestorIds = [...ancestorDepth].filter(([, d]) => d === depth).map(([id]) => id).sort(cmp)
    const candidates = commonAncestorIds.flatMap(childrenOfId)
    steps.push({ depth, commonAncestorIds, branchHeadIds: [...new Set(candidates.map(p => p.personId))].sort(cmp) })
    const heir = branches(candidates, depth)
    if (unresolved) return pending(unresolved, depth)
    if (heir) return done({ status: 'READY', personId: heir.personId, rankedCandidateIds: ranked, relation: 'COLLATERAL' }, depth)
  }
  if (missingAncestorDepths.length > 0) return pending('ANCESTOR_RECORD_MISSING', null)
  return pending('NO_ESTABLISHED_HEIR', null, ['RECORDED_ANCESTRY_EXHAUSTED'])
}

/** 評価器構成で選ぶ相続順位の照合器。既定は旧同胞枝までの探索。 */
export function heirReviewerFor(mode: HeirSearchMode | undefined): (world: WorldState, predecessorId: Id) => HeirReview | AncestralHeirReview {
  return mode === 'RECORDED_COMMON_ANCESTOR' ? reviewAncestralHeir : reviewLandHeir
}
