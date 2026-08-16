import { isAbsolute, relative, resolve, sep } from 'path';

/**
 * Filesystem questions the resolver needs. Injected so resolution stays pure and
 * testable, and so callers decide which probes are safe in their context.
 */
export interface LocalLinkProbe {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
}

export type LocalLinkOrigin = 'absolute' | 'vault' | 'unchanged';

export interface LocalLinkResolution {
  /** Target handed to reference classification. */
  uri: string;
  origin: LocalLinkOrigin;
}

export interface LocalLinkResolutionOptions {
  /** When false, a root-looking target can only resolve beneath the vault root. */
  allowAbsoluteTargets?: boolean;
}

const SCHEME_OR_DRIVE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * OKF concept IDs omit `.md`, bundle-relative links begin with `/`, and
 * hierarchical indexes may link to a directory.
 *
 * A root-looking target is ambiguous: `/playbook/guide.md` can mean a real
 * absolute path or a bundle-relative one. For an explicit, trusted navigation
 * request, the real absolute file wins; when it does not exist (or the caller
 * did not opt in), the target falls back to the bundle-relative vault path.
 */
export function resolveLocalLinkTarget(
  vaultRoot: string | undefined,
  uri: string,
  probe: LocalLinkProbe,
  options: LocalLinkResolutionOptions = {},
): LocalLinkResolution {
  const unchanged: LocalLinkResolution = { uri, origin: 'unchanged' };
  if (!vaultRoot || !uri || uri.startsWith('#') || SCHEME_OR_DRIVE.test(uri)) return unchanged;

  const suffixIndex = uri.search(/[?#]/);
  const rawPath = suffixIndex < 0 ? uri : uri.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? '' : uri.slice(suffixIndex);
  if (!rawPath) return unchanged;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    decodedPath = rawPath;
  }
  if (decodedPath.includes('\0')) return unchanged;

  const bundlePath = decodedPath.replace(/^[/\\]+/, '');
  if (!bundlePath) return unchanged;

  // A leading double separator is a UNC path on Windows, where merely probing it
  // opens an outbound SMB connection. Never touch the filesystem for one.
  const uncPath = /^[/\\]{2}/.test(decodedPath);
  const rootLooking = /^[/\\]/.test(rawPath);

  if (rootLooking && options.allowAbsoluteTargets === true && !uncPath) {
    const absolutePath = resolve(decodedPath);
    if (probe.exists(absolutePath) && !probe.isDirectory(absolutePath)) {
      return { uri: `${absolutePath}${suffix}`, origin: 'absolute' };
    }
  }

  const vaultTarget = vaultRelativeTarget(vaultRoot, bundlePath, suffix, probe);
  if (vaultTarget) return vaultTarget;

  // Inside a bundle a leading slash is bundle-relative, never filesystem-root
  // absolute, so drop it even when nothing matched yet and let the caller
  // report or create a contained target.
  if (rootLooking) return { uri: `${bundlePath}${suffix}`, origin: 'vault' };
  return unchanged;
}

function vaultRelativeTarget(
  vaultRoot: string,
  bundlePath: string,
  suffix: string,
  probe: LocalLinkProbe,
): LocalLinkResolution | undefined {
  const direct = containedVaultPath(vaultRoot, bundlePath);
  if (direct && probe.exists(direct)) {
    if (probe.isDirectory(direct)) {
      const indexPath = containedVaultPath(
        vaultRoot,
        `${bundlePath.replace(/[\\/]+$/, '')}/index.md`,
      );
      if (indexPath && probe.exists(indexPath)) {
        return { uri: `${vaultRelativePath(vaultRoot, indexPath)}${suffix}`, origin: 'vault' };
      }
    }
    return { uri: `${vaultRelativePath(vaultRoot, direct)}${suffix}`, origin: 'vault' };
  }

  if (!/\.[^/\\]+$/.test(bundlePath)) {
    const concept = containedVaultPath(vaultRoot, `${bundlePath}.md`);
    if (concept && probe.exists(concept)) {
      return { uri: `${vaultRelativePath(vaultRoot, concept)}${suffix}`, origin: 'vault' };
    }
  }
  return undefined;
}

function containedVaultPath(vaultRoot: string, candidatePath: string): string | undefined {
  if (!candidatePath || isAbsolute(candidatePath)) return undefined;
  const root = resolve(vaultRoot);
  const candidate = resolve(root, candidatePath);
  return isVaultContained(root, candidate) ? candidate : undefined;
}

function isVaultContained(vaultRoot: string, filePath: string): boolean {
  const fromRoot = relative(resolve(vaultRoot), resolve(filePath));
  return fromRoot === ''
    || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot));
}

function vaultRelativePath(vaultRoot: string, filePath: string): string {
  return relative(resolve(vaultRoot), filePath).split(sep).join('/');
}
