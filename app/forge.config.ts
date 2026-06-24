import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerAppImage } from '@reforged/maker-appimage';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: './build/icon',
  },
  rebuildConfig: {},
  makers: [
    // Windows: Squirrel auto-installer (.exe) for direct download,
    // plus a portable .zip consumed by the Scoop manifest.
    new MakerSquirrel({}),
    new MakerZIP({}, ['win32']),
    // macOS: .dmg disk image — the installer, served direct and via Homebrew Cask.
    new MakerDMG({ icon: './build/icon.icns' }, ['darwin']),
    // Linux: AppImage only — one self-contained file, every distro, no repo index.
    new MakerAppImage(
      {
        options: {
          icon: './build/icon.png',
          categories: ['Office', 'ProjectManagement'],
        },
      },
      ['linux'],
    ),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: 'kevinpinscoe', name: 'vermilian' },
      // Each OS runner uploads to the same draft release; the channels job
      // flips it to published only after all platform builds succeed.
      draft: true,
      prerelease: false,
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
