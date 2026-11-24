# Awesome-OS Blender 5.3 Ghost (`blender-ghost`)

MIT-licensed Blender 5.3 extension for **Awesome-OS Code - OSS** and **Eclipse Theia** (Open VSX / VS Code compatible).

## Features

- **Instant `b8g-ghost @ cas-v1` Hydration:** Resolves and verifies rolling-latest Blender `5.3.0` (`blender-win64.tar.zst` / `blender-linux-x64.tar.zst`) alongside `libsectium_display` and `b8g-ghost-abi` directly from [`awesome-os/b8g-ghost`](https://github.com/awesome-os/b8g-ghost) (`cas-v1`).
- **`bpy` Script Execution & Addon Live Reload:** Builds deterministic Blender command invocations with `--python`, `--python-expr`, `--python-exit-code 1`, and optional `--background` execution.
- **`libsectium_display` Viewport Bridge:** Wires native host pipe IPC (`\\.\pipe\sectium-dev` on Windows, `/tmp/sectium-dev.sock` on POSIX) so Blender viewports stream cleanly into Sectium without local HTTP servers.
- **Erasable TypeScript (`erasableSyntaxOnly: true`):** Runs directly on Node 22+ / 24+ with zero transpilation or bundler overhead.

## Contributed Commands & Tasks

| Contribution | ID / Type | Description |
| :--- | :--- | :--- |
| Command | `blenderGhost.hydrate` | Hydrate Blender 5.3 + `libsectium_display` + `b8g-ghost-abi` from `b8g-ghost @ cas-v1` |
| Command | `blenderGhost.launch` | Launch Blender 5.3 with the `libsectium_display` viewport bridge |
| Command | `blenderGhost.runScript` | Run the active `bpy` Python script in Blender 5.3 |
| Command | `blenderGhost.reloadAddon` | Live-reload a Blender addon module via `bpy` |
| Task Definition | `blender-ghost` | Declarative VS Code / Theia task type (`hydrate`, `launch`, `runScript`, `reloadAddon`) |

## Usage

```ts
import {
  resolveBlenderStudioPlan,
  buildBlenderScriptCommand,
} from './src/extension.mts';

const plan = await resolveBlenderStudioPlan({ platform: 'win32', arch: 'x64' });
const cmd = buildBlenderScriptCommand({
  plan,
  scriptPath: 'scripts/export_scene.py',
  blendFile: 'scenes/hero.blend',
  background: true,
});
console.log(cmd.executable, cmd.args);
```

## Testing

```bash
node --test test/blender-vscode.test.mts
```

## License

[MIT](./LICENSE)
