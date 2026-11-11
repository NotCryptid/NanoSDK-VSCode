# NanoSDK Extension for Visual Studio Code

Comprehensive VS Code extension for developing **MicroOS** applications with **NanoSDK**.

## ✨ Features

- 📝 **Language Support (`.nsp`)**: Syntax highlighting, intelligent code completion, hover documentation, snippets, and document formatting.
- 🔍 **Real-Time Diagnostics & Linting**:
  - Validates 4-line header requirements (`DAN`, `DAI`, `ASM`, `TXP`).
  - Checks 3-digit number padding conventions (e.g. `005`, `020`) with QuickFix actions.
  - Matches control blocks (`IFB ... IFB end`, `LOP ... LOP end`, `WHN ... WHN end`).
  - Flags dangerous delimiter characters (`~`, `§`) that break MicroOS file formats.
  - Verifies existence of `DAI` icon asset files.
- ⚡ **Compiling to NSA (`.nsa`)**:
  - One-click compile button in status bar or editor title bar.
  - Inlines `.mpi` and `.wrt` icon pixel hex into binary headers matching MicroOS `compiler.ts`.
  - Full support for `:BLW` continuations, `LOP :BLW` conditional loops, and ListGUI multi-line options.
- 🎨 **Micro Paint Icon Creator (`.mpi` / `.wrt`)**:
  - Built-in visual pixel art editor with the exact 16-color MicroOS palette.
  - Drawing tools: Pencil, Eraser, Fill Bucket, Color Picker.
  - Live preview on MicroOS Desktop Taskbar and Library grid.
  - Fast transforms: Rotate, Flip Horizontal/Vertical, Invert, Clear.
  - Quick action to copy `DAI <filename>` line directly into your code.
- 🔬 **NSA Disassembler**:
  - Disassemble and inspect compiled `.nsa` binary files into structured bytecode tables and descriptions.

---

## 🚀 Quick Start

1. Open `C:\Users\crypt\.gemini\antigravity\scratch\nanosdk-vscode` in VS Code.
2. Press `F5` to launch the Extension Development Host.
3. Open any `.nsp` file or run **`NanoSDK: Create New NanoSDK Project (.nsp)`** from the Command Palette (`Ctrl+Shift+P`).
4. Click **`Compile to NSA`** in the status bar or editor title bar to produce the runnable `.nsa` application.
5. Double-click any `.mpi` or `.wrt` file to open the interactive **Micro Paint** visual editor.

---

## ⌨️ NanoSDK Syntax Quick Reference

### Header (Lines 1 to 4 required)
```text
DAN [Application Name]        // Line 1: Define Application Name
DAI [icon.mpi | default]      // Line 2: Define Application Icon Asset
ASM [main]                    // Line 3: Application Submenu
TXP [020]                     // Line 4: Title X Position (padded)
```

### NanoSDK 2027.1 (`nanosdk.compiler.version`)
Set `nanosdk.compiler.version` to `2027.1` to use the new packager, which mirrors MicroOS's own. It ships your plain source (validated, comments and indentation stripped) instead of compiled opcodes, and MicroOS decodes it when the app opens.

- 3-line header (`DAN`, `DAI`, `ASM`). `TXP` is gone: the title position is calculated automatically. A leftover `TXP` line is ignored with a warning.
- All indexes are 0-based (`LGS`, `LGV`, `LGR`, `LGH`, `WHN sel`).
- `LGO` takes a plain count (`LGO 3`, not `LGO str3`).
- A non-numeric `LOP` count, a bad `LOP :BLW` condition or any malformed command fails packaging (MicroOS error 301).
- Number padding is not required.
- Packages only run on MicroOS builds after 1.1.0. The built-in **Run** preview supports them by translating the package back to 2026.x form (TXP, `LGO strN`, 1-based `WHN sel`) before running, so it uses the 2026.x executor rather than MicroOS's new one.
- A `TXP` line is reported as a warning (it is ignored).

### Basic Commands
- `PRN [string]` — Displays popup message. Supports variable interpolation with `!var!`.
- `END [optional error]` — Closes the application.
- `ASM [submenu]` — Changes current submenu dynamically.

### Logic & Loops
- `IFB var [name] [eql|mor|les|moe|loe] [val]` / `IFB btn [button] [dwn|ndn]` / `IFB end`
- `LOP [count|inf|ext|end]`
- `LOP :BLW` (followed by `IFB ...` on next line for conditional loop)
- `WHN sel [001|002|...]` / `WHN btn [button] [state]` / `WHN end`

### ListGUI
- `CLG [ful|scl]` — Create ListGUI menu.
- `LGP [X] [Y]` / `LGD [W] [H]` — Position and dimensions.
- `LGO str[N]` followed by N lines — Set menu options.
- `LGS [0-based idx] [text]` — Update item text.
- `LGV [0-based idx] [var]` — Read selected item into variable.
- `LGR [0-based idx]` — Remove menu item.
- `DLG` — Destroy active menu.
- `LGH [off|auto|idx]` — Set highlight mode.
- `LGT [d|l|m]` — Theme (dark/light/match).
- `LSB [on|off]` — Scrollbar toggle.

### Variables
- `DVR [name] [val]` — Define variable.
- `SVR [name] [new_val]` — Set variable value.
- `VRM [name] [add|sub|mul|div] [num]` — Math operation.
- `VCJ [name] [text or !var!]` — String concatenation.
