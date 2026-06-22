# App Icon

Vermilian ships with the default Electron icon. You can replace it with any image by dropping three platform-specific files into `app/build/` and updating the forge config.

## Image requirements

| Platform | Format | Recommended source size | Notes |
|---|---|---|---|
| macOS | `.icns` | 1024×1024 | Multi-resolution container; macOS picks the right size at runtime |
| Windows | `.ico` | 256×256 | Multi-resolution container (256, 128, 64, 48, 32, 16 px embedded) |
| Linux | `.png` | 1024×1024 (512 minimum) | Plain PNG; desktop environments scale it |

### Converting from a single PNG

Start with a 1024×1024 PNG and convert to each format:

- **[Iconset](https://iconset.io)** — macOS app, generates `.icns` and `.ico` from a single PNG
- **`icotool`** (Linux) — `icotool -c -o icon.ico icon-256.png icon-128.png …`
- **`electron-icon-maker`** — npm package that generates all three formats: `npx electron-icon-maker --input=icon.png --output=./build`

## File placement

```
app/build/
  icon.icns   ← macOS
  icon.ico    ← Windows
  icon.png    ← Linux + runtime window icon
```

## Configuration

### `app/forge.config.ts`

```ts
packagerConfig: {
  asar: true,
  icon: './build/icon',   // no extension — forge picks the right format per platform
},
// ...
new MakerDeb({ options: { icon: './build/icon.png' } }),
new MakerRpm({ options: { icon: './build/icon.png' } }),
```

### `app/src/main/window.ts`

The window icon is shown in the taskbar/dock while the app is running. It is set independently of the packaged installer icon:

```ts
import path from 'path';

new BrowserWindow({
  icon: path.join(__dirname, '../build/icon.png'),
  // ...rest of options
})
```

`pnpm start` picks up the window icon immediately (no rebuild needed). `pnpm make` bakes the icon into the `.deb`, `.rpm`, `.dmg`, and `.exe` installer packages.
