import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { city, type Building, type Kind } from './input'
import { loadBlenderParts } from './route-a'
import { createBuilding as createDirectBuilding } from './route-b'
import './style.css'

type Factory = (kind: Kind) => THREE.Object3D
const views = document.querySelector<HTMLDivElement>('#views')!

function makeView(label: string, factory: Factory) {
  const section = document.createElement('section')
  const title = document.createElement('h2'); title.textContent = label
  const canvas = document.createElement('canvas'); section.append(title, canvas); views.append(section)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(640, 480, false); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#dce5e8')
  scene.add(new THREE.HemisphereLight(0xffffff, 0x697061, 2))
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(-10, 20, 12); scene.add(sun)
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 200)
  camera.position.set(28, 32, 36); camera.lookAt(0, 1, 0)
  const controls = new OrbitControls(camera, canvas); controls.target.set(0, 1, 0); controls.enableRotate = false; controls.update()
  const stone = new THREE.MeshStandardMaterial({ color: '#999780', roughness: 1 })
  for (const d of city.districts) {
    const ground = new THREE.Mesh(new THREE.BoxGeometry(d.width, d.y + 2, d.depth), stone)
    ground.position.set(d.x, (d.y - 2) / 2, d.z); ground.name = `terrain:${d.id}`; scene.add(ground)
  }
  const a = new THREE.Vector3(...city.bridge.from), b = new THREE.Vector3(...city.bridge.to)
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(a.distanceTo(b), 0.3, city.bridge.width), stone)
  bridge.position.copy(a).add(b).multiplyScalar(0.5); bridge.rotation.z = Math.atan2(b.y - a.y, b.x - a.x); bridge.name = 'bridge'; scene.add(bridge)
  const objects = new Map<string, THREE.Object3D>()
  function updateBuilding(building: Building) {
    let object = objects.get(building.id)
    if (!object || object.userData.kind !== building.kind) {
      if (object) scene.remove(object)
      object = factory(building.kind); object.name = building.id; object.userData.kind = building.kind
      object.traverse(child => { if (child instanceof THREE.Mesh) child.material = new THREE.MeshStandardMaterial({ color: building.affiliation, roughness: 1 }) })
      scene.add(object); objects.set(building.id, object)
    }
    object.position.set(building.x, building.y, building.z); object.scale.set(building.width, building.height, building.depth)
    object.traverse(child => { if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) child.material.color.set(building.affiliation) })
  }
  city.buildings.forEach(updateBuilding)
  controls.addEventListener('change', () => renderer.render(scene, camera)); renderer.render(scene, camera)
  return { scene, camera, renderer, objects, updateBuilding, render: () => renderer.render(scene, camera) }
}

async function start() {
  let a: ReturnType<typeof makeView> | undefined
  try {
    const blender = await loadBlenderParts()
    a = makeView('経路 A', blender)
  } catch (error) {
    const message = document.createElement('p')
    message.textContent = `経路 A は未表示です（GLB の読込み失敗）。`
    views.append(message)
    console.error(error)
  }
  const b = makeView('経路 B', createDirectBuilding)
  Object.assign(window, { experiment: { a, b, city } })
}
start().catch(error => { const p = document.createElement('p'); p.textContent = `読込みエラー: ${String(error)}`; document.body.append(p); console.error(error) })
