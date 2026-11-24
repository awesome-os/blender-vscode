import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  activate,
  buildBlenderScriptCommand,
  deactivate,
  EXTENSION_COMMANDS,
  fetchGhostIndex,
  getBlenderAssetKey,
  getGhostAbiAssetKey,
  getSectiumDisplayAssetKey,
  resolveBlenderStudioPlan,
  type ExtensionDisposable,
  type ExtensionHostApi,
} from '../src/extension.mts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('resolves live b8g-ghost cas-v1 Blender 5.3.0 + libsectium_display + b8g-ghost-abi for win64 and linux-x64', async () => {
  const index = await fetchGhostIndex(true);
  assert.equal(index.schema, 'b8g-ghost-cas-index-v1');
  assert.ok(index.total_entries > 0, 'Expected non-empty cas-v1 index');

  const winPlan = await resolveBlenderStudioPlan({ platform: 'win32', arch: 'x64', index });
  assert.equal(winPlan.blender.filename, 'blender-win64.tar.zst');
  assert.equal(winPlan.blender.version, '5.3.0');
  assert.match(winPlan.blender.sha256, /^[a-f0-9]{64}$/);
  assert.ok(winPlan.blender.bytes > 100_000_000, 'Expected real Blender win64 archive (>100 MB)');
  assert.equal(winPlan.sectiumDisplay.filename, 'libsectium_display.dll');
  assert.match(winPlan.sectiumDisplay.sha256, /^[a-f0-9]{64}$/);
  assert.equal(winPlan.ghostAbi.filename, 'b8g-ghost-abi-win64.node');
  assert.equal(winPlan.viewportBridge.pipePath, '\\\\.\\pipe\\sectium-dev');
  assert.equal(winPlan.viewportBridge.channel, 'display');

  const linuxPlan = await resolveBlenderStudioPlan({ platform: 'linux', arch: 'x64', index });
  assert.equal(linuxPlan.blender.filename, 'blender-linux-x64.tar.zst');
  assert.equal(linuxPlan.blender.version, '5.3.0');
  assert.match(linuxPlan.blender.sha256, /^[a-f0-9]{64}$/);
  assert.ok(linuxPlan.blender.bytes > 100_000_000, 'Expected real Blender linux-x64 archive (>100 MB)');
  assert.equal(linuxPlan.sectiumDisplay.filename, 'libsectium_display-linux-x64.so');
  assert.match(linuxPlan.sectiumDisplay.sha256, /^[a-f0-9]{64}$/);
  assert.equal(linuxPlan.ghostAbi.filename, 'b8g-ghost-abi-linux-x64.node');
  assert.equal(linuxPlan.viewportBridge.pipePath, '/tmp/sectium-dev.sock');
});

test('maps platform asset keys for Blender, libsectium_display, and b8g-ghost-abi', () => {
  assert.equal(getBlenderAssetKey('win32', 'x64'), 'blender-win64.tar.zst');
  assert.equal(getBlenderAssetKey('linux', 'x64'), 'blender-linux-x64.tar.zst');
  assert.equal(getSectiumDisplayAssetKey('win32', 'x64'), 'libsectium_display.dll');
  assert.equal(getSectiumDisplayAssetKey('linux', 'x64'), 'libsectium_display-linux-x64.so');
  assert.equal(getSectiumDisplayAssetKey('linux', 'arm64'), 'libsectium_display-linux-arm64.so');
  assert.equal(getSectiumDisplayAssetKey('darwin', 'arm64'), 'libsectium_display-macos-arm64.dylib');
  assert.equal(getGhostAbiAssetKey('win32', 'x64'), 'b8g-ghost-abi-win64.node');
  assert.equal(getGhostAbiAssetKey('linux', 'x64'), 'b8g-ghost-abi-linux-x64.node');
});

test('buildBlenderScriptCommand builds bpy script and addon live-reload commands with libsectium_display env', async () => {
  const plan = await resolveBlenderStudioPlan({ platform: 'linux', arch: 'x64' });

  const scriptCmd = buildBlenderScriptCommand({
    plan,
    blendFile: 'scenes/demo.blend',
    scriptPath: 'scripts/bake.py',
    background: true,
    factoryStartup: true,
    extraArgs: ['--samples', '64'],
  });
  assert.equal(scriptCmd.mode, 'runScript');
  assert.equal(scriptCmd.executable, plan.executablePath);
  assert.deepEqual(scriptCmd.args, [
    '--background',
    '--factory-startup',
    'scenes/demo.blend',
    '--python-exit-code',
    '1',
    '--python',
    'scripts/bake.py',
    '--',
    '--samples',
    '64',
  ]);
  assert.equal(scriptCmd.env.SECTIUM_DISPLAY_PIPE, '/tmp/sectium-dev.sock');
  assert.equal(scriptCmd.env.SECTIUM_DISPLAY_CHANNEL, 'display');
  assert.equal(scriptCmd.env.B8G_GHOST_BLENDER_SHA256, plan.blender.sha256);
  assert.equal(scriptCmd.env.SECTIUM_DISPLAY_SHA256, plan.sectiumDisplay.sha256);

  const reloadCmd = buildBlenderScriptCommand({
    plan,
    addonModule: 'awesome_os_viewport',
  });
  assert.equal(reloadCmd.mode, 'reloadAddon');
  assert.equal(reloadCmd.args[0], '--python-exit-code');
  assert.equal(reloadCmd.args[1], '1');
  assert.equal(reloadCmd.args[2], '--python-expr');
  assert.ok(reloadCmd.args[3].includes('awesome_os_viewport'));
  assert.ok(reloadCmd.args[3].includes('importlib.reload'));
});

test('package.json defines valid Open VSX / VS Code extension manifest and contributions', () => {
  const manifestPath = resolve(REPO_ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name: string;
    publisher: string;
    type: string;
    license: string;
    main: string;
    engines: { vscode?: string };
    contributes: {
      commands: Array<{ command: string; title: string }>;
      taskDefinitions: Array<{ type: string; required?: string[] }>;
    };
  };

  assert.equal(pkg.name, 'blender-ghost');
  assert.equal(pkg.publisher, 'awesome-os');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.main, './src/extension.mts');
  assert.ok(pkg.engines.vscode, 'Expected vscode engine constraint');

  const commandIds = pkg.contributes.commands.map((c) => c.command);
  assert.deepEqual(commandIds, [...EXTENSION_COMMANDS]);

  const taskTypes = pkg.contributes.taskDefinitions.map((t) => t.type);
  assert.ok(taskTypes.includes('blender-ghost'), 'Expected blender-ghost task definition');
});

test('activate() registers all commands and blender-ghost task provider and deactivate() disposes them', async () => {
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  const taskProviders: string[] = [];
  let disposedCount = 0;

  const mockHost: ExtensionHostApi = {
    commands: {
      registerCommand(command, callback) {
        registered.set(command, callback);
        return {
          dispose() {
            disposedCount += 1;
          },
        };
      },
    },
    tasks: {
      registerTaskProvider(type) {
        taskProviders.push(type);
        return {
          dispose() {
            disposedCount += 1;
          },
        };
      },
    },
    window: {
      showInformationMessage() {},
      showErrorMessage() {},
    },
  };

  const subscriptions: ExtensionDisposable[] = [];
  const handle = await activate({ subscriptions, hostApi: mockHost });

  assert.equal(handle.extensionId, 'awesome-os.blender-ghost');
  assert.equal(handle.taskType, 'blender-ghost');
  assert.deepEqual([...registered.keys()], [...EXTENSION_COMMANDS]);
  assert.deepEqual(taskProviders, ['blender-ghost']);
  assert.equal(subscriptions.length, EXTENSION_COMMANDS.length + 1);

  deactivate();
  assert.equal(disposedCount, EXTENSION_COMMANDS.length + 1);
});
