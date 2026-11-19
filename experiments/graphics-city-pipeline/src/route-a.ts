/// <reference types="vite/client" />
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Kind } from './input'

/** Load the Blender-exported templates once; callers receive separate objects. */
export async function loadBlenderParts(): Promise<(kind: Kind) => THREE.Object3D> {
  const loader = new GLTFLoader()
  const base = import.meta.env.BASE_URL
  const [block, taper] = await Promise.all([
    loader.loadAsync(`${base}a/block.glb`),
    loader.loadAsync(`${base}a/taper.glb`),
  ])
  const parts: Record<Kind, THREE.Object3D> = { block: block.scene, taper: taper.scene }
  return (kind: Kind) => parts[kind].clone(true)
}
