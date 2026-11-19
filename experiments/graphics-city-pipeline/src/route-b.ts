import * as THREE from 'three'
import type { Kind } from './input'

// The display owns placement, scaling and affiliation material. These geometries
// are immutable templates, shared by instances so updates need not rebuild them.
const block = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const indexedTaper = new THREE.CylinderGeometry(0.6 / Math.SQRT2, 1 / Math.SQRT2, 1, 4, 1)
const taper = indexedTaper.toNonIndexed()
indexedTaper.dispose()
taper.rotateY(Math.PI / 4).translate(0, 0.5, 0)
taper.computeVertexNormals()
const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })

export function createBuilding(kind: Kind): THREE.Object3D {
  return new THREE.Mesh(kind === 'block' ? block : taper, material)
}
