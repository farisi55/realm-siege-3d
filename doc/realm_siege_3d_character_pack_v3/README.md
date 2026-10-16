REALM SIEGE 3D — CHARACTER PACK V3

5 original humanoid GLB characters built for Three.js integration.
Each character is a true glTF skin with a SkinnedMesh primitive, 18-bone humanoid rig, inverse bind matrices, and 8 clips (Idle, Walk, Run, Attack, Cast, Hit, Death, Victory).

Coordinate system: Y-up; character forward: -Z; 1 unit = 1 meter; approx height 2.05m.

Three.js integration:
const gltf = await loader.loadAsync('/assets/characters/arcane-knight-v3.glb');
const mixer = new THREE.AnimationMixer(gltf.scene);
const actions = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
actions.Walk.play();

All 5 characters share the same bone names, so one animation mapping can be reused:
Root, Pelvis, Spine, Chest, Neck, Head, LeftUpperArm, LeftLowerArm, LeftHand, RightUpperArm, RightLowerArm, RightHand, LeftUpperLeg, LeftLowerLeg, LeftFoot, RightUpperLeg, RightLowerLeg, RightFoot.

Sockets: WeaponSocket, HeadSocket, ChestSocket, RootSocket.

No Dota 2 character meshes, textures, animations, logos, or sounds are used.
