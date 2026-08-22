import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const CENTRIFUGO_VERSION = '6.6.2';

function resolveArchiveTarget(platform, arch) {
  const platformName =
    platform === 'win32'
      ? 'windows'
      : platform === 'darwin'
        ? 'darwin'
        : 'linux';
  const architecture =
    arch === 'arm64' ? 'arm64' : arch === 'ia32' ? '386' : 'amd64';
  const extension = platform === 'win32' ? 'zip' : 'tar.gz';
  return {
    platformName,
    architecture,
    asset: `centrifugo_${CENTRIFUGO_VERSION}_${platformName}_${architecture}.${extension}`,
    binaryName: platform === 'win32' ? 'centrifugo.exe' : 'centrifugo',
  };
}

export function resolveCentrifugoDownloadUrls({
  region = 'global',
  asset,
  version = CENTRIFUGO_VERSION,
  mirrorBaseUrl = process.env.CENTRIFUGO_CN_MIRROR_BASE_URL ??
    'https://gh-proxy.com/https://github.com',
} = {}) {
  const githubUrl = `https://github.com/centrifugal/centrifugo/releases/download/v${version}/${asset}`;
  if (region !== 'cn') return [githubUrl];

  const mirrorUrl = `${mirrorBaseUrl.replace(/\/$/, '')}/centrifugal/centrifugo/releases/download/v${version}/${asset}`;
  return [mirrorUrl, githubUrl];
}

export function resolveCentrifugoBinaryPath(
  rootDir,
  platform = process.platform,
) {
  return path.join(
    rootDir,
    'scripts',
    'backend',
    'bin',
    platform === 'win32' ? 'centrifugo.exe' : 'centrifugo',
  );
}

function commandOutput(command, args, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function downloadArchive(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download returned HTTP ${response.status}`);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination),
  );
}

async function extractArchive({ archive, destination, platform }) {
  const args = platform === 'win32' ? ['-xf'] : ['-xzf'];
  const result = spawnSync('tar', [...args, archive, '-C', destination], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `tar extraction failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`,
    );
  }
  if (platform !== 'win32') {
    await chmod(path.join(destination, 'centrifugo'), 0o755);
  }
}

export async function ensureCentrifugoBinary({
  rootDir,
  platform = process.platform,
  arch = process.arch,
  region = 'global',
  existsSyncImpl = existsSync,
  commandOutputImpl = commandOutput,
  downloadImpl = downloadArchive,
  extractImpl = extractArchive,
  mirrorBaseUrl,
  output = () => {},
} = {}) {
  const { asset, binaryName } = resolveArchiveTarget(platform, arch);
  const binaryPath = resolveCentrifugoBinaryPath(rootDir, platform);
  const binDir = path.dirname(binaryPath);
  const archivePath = path.join(binDir, `${asset}.download`);
  const isUsable = () =>
    existsSyncImpl(binaryPath) &&
    Boolean(commandOutputImpl(binaryPath, ['version']));

  if (isUsable()) return { available: true, downloaded: false, binaryPath };

  await mkdir(binDir, { recursive: true });
  const urls = resolveCentrifugoDownloadUrls({
    region,
    asset,
    mirrorBaseUrl,
  });
  let lastError;

  for (const url of urls) {
    try {
      output(`[community-dev] 尝试下载 Centrifugo（${region}）：${url}`);
      await downloadImpl(url, archivePath);
      await extractImpl({
        archive: archivePath,
        destination: binDir,
        platform,
      });
      if (isUsable()) {
        return { available: true, downloaded: true, binaryPath, url };
      }
      throw new Error(
        `downloaded archive did not provide a usable ${binaryName}`,
      );
    } catch (error) {
      lastError = error;
      output(
        `[community-dev] Centrifugo 下载尝试失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await unlink(archivePath).catch(() => {});
    }
  }

  return {
    available: false,
    downloaded: false,
    binaryPath,
    attemptedUrls: urls,
    error: lastError,
  };
}
