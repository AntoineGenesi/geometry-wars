## 2026-02-08 - Colyseus Schema v2 + ES2022 useDefineForClassFields Bug

**Context:** LAN multiplayer joiner could connect but saw no game state - all values were `undefined`. Server confirmed state was populated.

**Root Cause:**
`@colyseus/schema` v2.0.37 + TypeScript ES2022 target breaks state encoding.

The `Schema` constructor installs getter/setter descriptors on `this` via `Object.defineProperties()`. These setters call `this.$changes.change(field)` for change tracking. But with ES2022 target, TypeScript compiles class field initializers (e.g., `surfaceType: string = 'sphere'`) to `Object.defineProperty(this, 'surfaceType', { value: 'sphere', writable: true, ... })` which **overwrites** the getter/setter with a plain value property. This destroys change tracking.

Even `id!: string` (definite assignment with no initializer) emits `Object.defineProperty` in esbuild/tsx because ES2022 spec mandates `[[Define]]` semantics for class fields.

Result: `$changes.allChanges` is always empty, `encodeAll()` returns empty array, `ROOM_STATE` message contains zero bytes of data.

**Diagnostic Trail:**
1. Client connects, gets schema reflection (handshake) - OK
2. Server state is populated (logs confirm `players.size=1`)
3. Client receives ROOM_STATE with 1 byte (just protocol code, 0 data)
4. `state.encodeAll()` returns empty array even after mutations
5. `$changes.allChanges.size === 0` (no changes tracked)
6. Root cause: ES2022 `Object.defineProperty` in class fields overwrites Schema setters

**Fix:** Use `declare` keyword for all schema properties (emits NO JavaScript), set defaults in constructor body (goes through tracked setters):

```typescript
// BROKEN: Class field initializer overwrites getter/setter
export class GameState extends Schema {
  surfaceType: string = 'sphere'; // Object.defineProperty overwrites setter!
}

// ALSO BROKEN: !: still emits Object.defineProperty with esbuild
export class GameState extends Schema {
  surfaceType!: string; // Still emits defineProperty!
}

// FIXED: declare emits NO JavaScript, constructor goes through setter
export class GameState extends Schema {
  declare surfaceType: string;
  constructor() {
    super(); // Schema installs getters/setters
    this.surfaceType = 'sphere'; // Goes through setter, triggers change tracking
  }
}
```

**Affected file:** `server/schema/GameState.ts` - all 6 schema classes (PlayerState, BulletState, EnemyState, GeomState, WeaponPickupState, GameState)

**Reversibility:** Easy - revert the file to use class field initializers and add `useDefineForClassFields: false` to a server-specific tsconfig that `tsx` picks up.

**Key Lesson:** When using `@colyseus/schema` (or any library that relies on prototype getter/setters) with TypeScript ES2022 target and esbuild/tsx, ALWAYS use `declare` for property declarations. The `!:` syntax is NOT sufficient because esbuild still emits `Object.defineProperty` for it.
