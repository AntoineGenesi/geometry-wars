import { describeGenericMeshGameplayContract } from './helpers/GenericMeshGameplayContract';

describeGenericMeshGameplayContract([
  { kind: 'built-in', type: 'sphere' },
  { kind: 'built-in', type: 'cube' },
  { kind: 'built-in', type: 'cube-ring' },
  {
    kind: 'obj',
    path: 'public/meshes/cup.obj',
    label: 'imported OBJ cup',
    targetRadius: 8,
  },
]);
