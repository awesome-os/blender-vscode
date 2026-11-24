/**
 * @file src/extension.mts
 * @description MIT Blender 5.3 extension for Awesome-OS Code - OSS & Eclipse Theia.
 *   Resolves live `blender-win64.tar.zst` / `blender-linux-x64.tar.zst` (5.3.0),
 *   `libsectium_display`, and `b8g-ghost-abi` from `awesome-os/b8g-ghost @ cas-v1`,
 *   builds deterministic `bpy` script and addon live-reload commands, and registers
 *   VS Code / Theia commands and `blender-ghost` task providers.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export const GHOST_INDEX_URL =
  process.env.B8G_GHOST_INDEX_URL ??
  'https://raw.githubusercontent.com/awesome-os/b8g-ghost/main/manifests/index.json';

export const GHOST_CAS_BASE_URL =
  process.env.B8G_GHOST_CAS_URL ??
  'https://github.com/awesome-os/b8g-ghost/releases/download/cas-v1';

export const EXTENSION_ID = 'awesome-os.blender-ghost';

export const EXTENSION_COMMANDS = [
  'blenderGhost.hydrate',
  'blenderGhost.launch',
  'blenderGhost.runScript',
  'blenderGhost.reloadAddon',
] as const;

export type ExtensionCommandId = (typeof EXTENSION_COMMANDS)[number];

export interface GhostCasHistoryItem {
  sha256: string;
  bytes: number;
  version?: string;
  retired_at?: string;
}

export interface GhostCasEntry {
  filename: string;
  sha256: string;
  bytes: number;
  raw_bytes?: number;
  version?: string;
  category?: string;
  download_url: string;
  history?: Array<GhostCasHistoryItem | string>;
}

export interface GhostIndex {
  schema: string;
  cas_base_url: string;
  updated_at: string;
  total_entries: number;
  entries: Record<string, GhostCasEntry>;
}

export interface ResolveBlenderStudioPlanOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  index?: GhostIndex;
  indexUrl?: string;
  cacheDir?: string;
  pinnedSha256?: string;
  forceRefresh?: boolean;
}

export interface ViewportBridgeConfig {
  libraryAsset: GhostCasEntry;
  pipePath: string;
  channel: 'display';
}

export interface BlenderStudioPlan {
  extensionId: string;
  platform: NodeJS.Platform;
  arch: string;
  indexSchema: string;
  casBaseUrl: string;
  blender: GhostCasEntry;
  sectiumDisplay: GhostCasEntry;
  ghostAbi: GhostCasEntry;
  viewportBridge: ViewportBridgeConfig;
  cacheDir: string;
  installDir: string;
  executablePath: string;
}

export interface BuildBlenderScriptCommandOptions {
  plan: BlenderStudioPlan;
  scriptPath?: string;
  addonModule?: string;
  blendFile?: string;
  background?: boolean;
  factoryStartup?: boolean;
  pythonExitCode?: number;
  extraArgs?: string[];
  enableSectiumViewport?: boolean;
}

export interface BlenderCommandSpec {
  executable: string;
  args: string[];
  env: Record<string, string>;
  mode: 'launch' | 'runScript' | 'reloadAddon';
}

export interface ExtensionDisposable {
  dispose(): void;
}

export interface ExtensionHostApi {
  commands: {
    registerCommand(
      command: string,
      callback: (...args: unknown[]) => unknown,
    ): ExtensionDisposable;
  };
  tasks?: {
    registerTaskProvider(type: string, provider: unknown): ExtensionDisposable;
  };
  window?: {
    showInformationMessage(message: string): unknown;
    showErrorMessage(message: string): unknown;
    activeTextEditor?: { document?: { fileName?: string } };
  };
}

export interface ExtensionContextLike {
  subscriptions: ExtensionDisposable[];
  hostApi?: ExtensionHostApi;
}

export interface ActivationHandle {
  extensionId: string;
  registeredCommands: ExtensionCommandId[];
  taskType: 'blender-ghost';
  disposables: ExtensionDisposable[];
}

let cachedIndex: GhostIndex | null = null;
let cachedIndexUrl: string | null = null;
let activeDisposables: ExtensionDisposable[] = [];

export function getBlenderAssetKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32') return 'blender-win64.tar.zst';
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'blender-macos-arm64.tar.zst' : 'blender-macos-x64.tar.zst';
  }
  return arch === 'arm64' ? 'blender-linux-arm64.tar.zst' : 'blender-linux-x64.tar.zst';
}

export function getSectiumDisplayAssetKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32') return 'libsectium_display.dll';
  if (platform === 'darwin') return 'libsectium_display-macos-arm64.dylib';
  return arch === 'arm64'
    ? 'libsectium_display-linux-arm64.so'
    : 'libsectium_display-linux-x64.so';
}

export function getGhostAbiAssetKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32') return 'b8g-ghost-abi-win64.node';
  if (platform === 'darwin') return 'b8g-ghost-abi-macos-arm64.node';
  return arch === 'arm64'
    ? 'b8g-ghost-abi-linux-arm64.node'
    : 'b8g-ghost-abi-linux-x64.node';
}

export function getBlenderExecutableRelPath(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') return 'blender.exe';
  if (platform === 'darwin') return join('Blender.app', 'Contents', 'MacOS', 'Blender');
  return 'blender';
}

export function getSectiumPipePath(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? '\\\\.\\pipe\\sectium-dev' : '/tmp/sectium-dev.sock';
}

export async function fetchGhostIndex(
  forceRefresh = false,
  indexUrl: string = GHOST_INDEX_URL,
): Promise<GhostIndex> {
  if (cachedIndex && cachedIndexUrl === indexUrl && !forceRefresh) {
    return cachedIndex;
  }

  const res = await fetch(indexUrl, {
    headers: { 'User-Agent': 'awesome-os-blender-vscode/0.1.0' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching b8g-ghost cas-v1 index from ${indexUrl}`);
  }

  const json = (await res.json()) as GhostIndex;
  cachedIndex = json;
  cachedIndexUrl = indexUrl;
  return json;
}

export function applyKeepLast5Pin(
  entry: GhostCasEntry,
  pinnedSha?: string,
  casBaseUrl: string = GHOST_CAS_BASE_URL,
): GhostCasEntry {
  const sha = pinnedSha?.trim().toLowerCase();
  if (!sha || sha === entry.sha256.toLowerCase()) {
    return entry;
  }
  const match = entry.history?.find(
    (item): item is GhostCasHistoryItem =>
      typeof item === 'object' && item !== null && item.sha256.toLowerCase() === sha,
  );
  if (match) {
    return {
      ...entry,
      sha256: match.sha256,
      bytes: match.bytes,
      version: match.version ?? entry.version,
      download_url: `${casBaseUrl}/${match.sha256}`,
    };
  }
  return entry;
}

function requireEntry(index: GhostIndex, key: string, label: string): GhostCasEntry {
  const entry = index.entries[key];
  if (!entry) {
    throw new Error(
      `Missing ${label} asset "${key}" in b8g-ghost cas-v1 index (${index.total_entries} entries).`,
    );
  }
  return entry;
}

export async function resolveBlenderStudioPlan(
  options: ResolveBlenderStudioPlanOptions = {},
): Promise<BlenderStudioPlan> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const index =
    options.index ??
    (await fetchGhostIndex(options.forceRefresh ?? false, options.indexUrl ?? GHOST_INDEX_URL));

  const casBaseUrl = index.cas_base_url || GHOST_CAS_BASE_URL;
  const blenderKey = getBlenderAssetKey(platform, arch);
  const sectiumKey = getSectiumDisplayAssetKey(platform, arch);
  const abiKey = getGhostAbiAssetKey(platform, arch);

  const rawBlender = requireEntry(index, blenderKey, 'Blender');
  const blender = applyKeepLast5Pin(
    rawBlender,
    options.pinnedSha256 ?? process.env.BLENDER_GHOST_SHA256,
    casBaseUrl,
  );
  const sectiumDisplay = requireEntry(index, sectiumKey, 'libsectium_display');
  const ghostAbi = requireEntry(index, abiKey, 'b8g-ghost-abi');

  const cacheDir =
    options.cacheDir ??
    process.env.B8G_GHOST_CACHE_DIR ??
    join(homedir(), '.b8g', 'cas');
  const installDir = join(cacheDir, 'blender', blender.sha256);
  const executablePath = join(installDir, getBlenderExecutableRelPath(platform));

  return {
    extensionId: EXTENSION_ID,
    platform,
    arch,
    indexSchema: index.schema,
    casBaseUrl,
    blender,
    sectiumDisplay,
    ghostAbi,
    viewportBridge: {
      libraryAsset: sectiumDisplay,
      pipePath: getSectiumPipePath(platform),
      channel: 'display',
    },
    cacheDir,
    installDir,
    executablePath,
  };
}

export function buildAddonReloadExpression(addonModule: string): string {
  const sanitized = addonModule.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(sanitized)) {
    throw new Error(`Invalid Blender addon module name: "${addonModule}"`);
  }
  return [
    'import importlib, sys, bpy',
    `mod_name = ${JSON.stringify(sanitized)}`,
    'bpy.ops.preferences.addon_disable(module=mod_name)',
    'if mod_name in sys.modules: importlib.reload(sys.modules[mod_name])',
    'bpy.ops.preferences.addon_enable(module=mod_name)',
    'bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)',
  ].join('; ');
}

export function buildBlenderScriptCommand(
  options: BuildBlenderScriptCommandOptions,
): BlenderCommandSpec {
  const { plan } = options;
  const args: string[] = [];

  if (options.background) {
    args.push('--background');
  }
  if (options.factoryStartup) {
    args.push('--factory-startup');
  }
  if (options.blendFile) {
    args.push(options.blendFile);
  }

  let mode: BlenderCommandSpec['mode'] = 'launch';

  if (options.addonModule) {
    mode = 'reloadAddon';
    args.push('--python-exit-code', String(options.pythonExitCode ?? 1));
    args.push('--python-expr', buildAddonReloadExpression(options.addonModule));
  } else if (options.scriptPath) {
    mode = 'runScript';
    args.push('--python-exit-code', String(options.pythonExitCode ?? 1));
    args.push('--python', options.scriptPath);
  }

  if (options.extraArgs && options.extraArgs.length > 0) {
    args.push('--', ...options.extraArgs);
  }

  const enableViewport = options.enableSectiumViewport ?? true;
  const env: Record<string, string> = {
    B8G_GHOST_CAS_URL: plan.casBaseUrl,
    B8G_GHOST_BLENDER_SHA256: plan.blender.sha256,
    B8G_GHOST_ABI_SHA256: plan.ghostAbi.sha256,
    B8G_GHOST_ABI_PATH: join(plan.cacheDir, 'abi', plan.ghostAbi.filename),
  };

  if (enableViewport) {
    env.SECTIUM_DISPLAY_LIB = join(plan.cacheDir, 'sectium', plan.sectiumDisplay.filename);
    env.SECTIUM_DISPLAY_SHA256 = plan.sectiumDisplay.sha256;
    env.SECTIUM_DISPLAY_PIPE = plan.viewportBridge.pipePath;
    env.SECTIUM_DISPLAY_CHANNEL = plan.viewportBridge.channel;
  }

  return {
    executable: plan.executablePath,
    args,
    env,
    mode,
  };
}

async function loadHostApi(context?: ExtensionContextLike): Promise<ExtensionHostApi | null> {
  if (context?.hostApi) {
    return context.hostApi;
  }
  try {
    const modName = 'vscode';
    const loaded = (await import(modName)) as unknown as ExtensionHostApi;
    return loaded && typeof loaded.commands?.registerCommand === 'function' ? loaded : null;
  } catch {
    return null;
  }
}

export async function activate(context?: ExtensionContextLike): Promise<ActivationHandle> {
  const disposables: ExtensionDisposable[] = [];
  const host = await loadHostApi(context);

  const handlers: Record<ExtensionCommandId, (...args: unknown[]) => Promise<unknown>> = {
    'blenderGhost.hydrate': async () => {
      const plan = await resolveBlenderStudioPlan();
      host?.window?.showInformationMessage(
        `Blender ${plan.blender.version ?? '5.3.0'} resolved (${plan.blender.filename})`,
      );
      return plan;
    },
    'blenderGhost.launch': async (blendFile?: unknown) => {
      const plan = await resolveBlenderStudioPlan();
      return buildBlenderScriptCommand({
        plan,
        blendFile: typeof blendFile === 'string' ? blendFile : undefined,
      });
    },
    'blenderGhost.runScript': async (scriptPath?: unknown, background?: unknown) => {
      const plan = await resolveBlenderStudioPlan();
      const targetScript =
        typeof scriptPath === 'string'
          ? scriptPath
          : host?.window?.activeTextEditor?.document?.fileName;
      if (!targetScript) {
        throw new Error('No active Python (bpy) script specified for blenderGhost.runScript.');
      }
      return buildBlenderScriptCommand({
        plan,
        scriptPath: targetScript,
        background: typeof background === 'boolean' ? background : false,
      });
    },
    'blenderGhost.reloadAddon': async (addonModule?: unknown) => {
      const plan = await resolveBlenderStudioPlan();
      const mod = typeof addonModule === 'string' && addonModule.trim() ? addonModule : 'awesome_os_bridge';
      return buildBlenderScriptCommand({
        plan,
        addonModule: mod,
      });
    },
  };

  if (host) {
    for (const commandId of EXTENSION_COMMANDS) {
      const disp = host.commands.registerCommand(commandId, handlers[commandId]);
      disposables.push(disp);
    }

    if (host.tasks?.registerTaskProvider) {
      const taskDisp = host.tasks.registerTaskProvider('blender-ghost', {
        provideTasks: async () => [],
        resolveTask: (task: unknown) => task,
      });
      disposables.push(taskDisp);
    }
  }

  if (context?.subscriptions) {
    context.subscriptions.push(...disposables);
  }
  activeDisposables = disposables;

  return {
    extensionId: EXTENSION_ID,
    registeredCommands: [...EXTENSION_COMMANDS],
    taskType: 'blender-ghost',
    disposables,
  };
}

export function deactivate(): void {
  for (const disp of activeDisposables) {
    try {
      disp.dispose();
    } catch {
      // Ignore disposal errors during shutdown
    }
  }
  activeDisposables = [];
}
