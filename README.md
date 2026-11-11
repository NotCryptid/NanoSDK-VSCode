# NanoSDK for Visual Studio Code

A VS Code extension for writing **MicroOS** apps in **NanoSDK**. It covers editing `.nsp` files, building `.nsa` apps, drawing icons, and running apps without leaving the editor.

## Features

- **Language support for `.nsp`.** Syntax highlighting, completion, hover docs, snippets, and formatting.
- **Diagnostics and linting.**
  - Checks the header: `DAN`, `DAI`, `ASM`, plus `TXP` on 2026.x.
  - Offers quick fixes for numbers that aren't padded to three digits (`005`, `020`). This only applies on 2026.x, and you can turn it off with `nanosdk.diagnostics.warnOnUnpaddedNumbers`.
  - Matches control blocks (`IFB ... IFB end`, `LOP ... LOP end`, `WHN ... WHN end`).
  - Flags the delimiter characters `~` and `§`, which break MicroOS file formats.
  - Checks that the `DAI` icon file exists.
- **Building `.nsa` files.** A status bar button and an editor title bar button build the app. On 2027.1 they run the packager, and on 2026.x they run the compiler. The 2026.x compiler inlines `.mpi` and `.wrt` icon pixel data into the binary header, matching MicroOS `compiler.ts`, and handles `:BLW` continuations, `LOP :BLW` conditional loops, and multi-line ListGUI options.
- **Built-in runtime.** **Run in NanoSDK Runtime** previews your app inside VS Code.
- **Micro Paint icon editor (`.mpi` / `.wrt`).**
  - Pixel editor using the 16-color MicroOS palette.
  - Pencil, eraser, fill bucket, and color picker.
  - Live preview on the MicroOS desktop taskbar and library grid.
  - Rotate, flip horizontally or vertically, invert, and clear.
  - One action copies a `DAI <filename>` line into your code.
- **NSA disassembler.** Opens a compiled `.nsa` file as a table of bytecode with descriptions.

---

## Quick start

1. Open an `.nsp` file, or run **NanoSDK: Create New NanoSDK Project (.nsp)** from the Command Palette (`Ctrl+Shift+P`).
2. Click **Package to NSA** (or **Compile to NSA** on 2026.x) in the status bar or editor title bar to produce the `.nsa` app.
3. Use **Run in NanoSDK Runtime** to try it without leaving VS Code.
4. Double-click an `.mpi` or `.wrt` file to open Micro Paint.

---

## Choosing a version

`nanosdk.compiler.version` selects the toolchain. It defaults to `2027.1`.

| Version | What it does | Runs on |
| --- | --- | --- |
| `2027.1` | Packages your plain source for MicroOS to decode | MicroOS builds after 1.1.0 |
| `2026.x` | Compiles to opcodes | MicroOS 0.1.0 to 1.1.0 |

### What 2027.1 changes

The 2027.1 packager mirrors the one in MicroOS. It validates your source, strips comments and indentation, and ships the result as plain text. MicroOS decodes it when the app opens, so nothing is compiled to opcodes.

- The header has three lines: `DAN`, `DAI`, `ASM`. `TXP` is gone because the title position is now calculated for you. A leftover `TXP` line is ignored and reported as a warning.
- All indexes are 0-based: `LGS`, `LGV`, `LGR`, `LGH`, and `WHN sel`.
- `LGO` takes a plain count, so write `LGO 3` instead of `LGO str3`.
- Number padding is optional.
- A non-numeric `LOP` count, a bad `LOP :BLW` condition, or any malformed command fails packaging with MicroOS error 301.
- The built-in **Run** preview can run 2027.1 packages, but it first translates them back to 2026.x form (`TXP`, `LGO strN`, 1-based `WHN sel`). That means it uses the 2026.x executor, not the new MicroOS one.

---

## Language reference

The full command list lives on the MicroOS wiki:

- [NanoSDK](https://github.com/NotCryptid/MicroOS/wiki/NanoSDK) is the latest spec (2027.1).
- [NanoSDK 2026.x](https://github.com/NotCryptid/MicroOS/wiki/NanoSDK-2026.x) is the frozen, finalized 2026.x spec.

A minimal 2027.1 program starts with a three-line header:

```text
DAN [Application Name]
DAI [icon.mpi | default]
ASM [main]
```
