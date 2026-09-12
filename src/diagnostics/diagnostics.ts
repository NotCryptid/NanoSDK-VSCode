import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { nsc_tokens } from '../compiler/compiler';

export function updateDiagnostics(
    document: vscode.TextDocument,
    collection: vscode.DiagnosticCollection
): void {
    if (document.languageId !== 'nanosdk') {
        return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const config = vscode.workspace.getConfiguration('nanosdk');
    const warnUnpadded = config.get<boolean>('diagnostics.warnOnUnpaddedNumbers', true);

    const text = document.getText();
    const lineCount = document.lineCount;

    // Check illegal chars in entire doc
    for (let li = 0; li < lineCount; li++) {
        const line = document.lineAt(li);
        const lText = line.text;

        const tildeIdx = lText.indexOf('~');
        if (tildeIdx !== -1) {
            const range = new vscode.Range(li, tildeIdx, li, tildeIdx + 1);
            diagnostics.push(new vscode.Diagnostic(
                range,
                "Character '~' is reserved as a line delimiter in MicroOS and will corrupt saving/compiling.",
                vscode.DiagnosticSeverity.Error
            ));
        }

        const sectIdx = lText.indexOf('§');
        if (sectIdx !== -1) {
            const range = new vscode.Range(li, sectIdx, li, sectIdx + 1);
            diagnostics.push(new vscode.Diagnostic(
                range,
                "Character '§' is reserved as an opcode delimiter in MicroOS and will corrupt compiling.",
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    // Filter meaningful lines
    interface TrackedLine {
        lineIndex: number;
        text: string;
        tokens: string[];
    }

    const nonCommentLines: TrackedLine[] = [];
    for (let li = 0; li < lineCount; li++) {
        const raw = document.lineAt(li).text.trim();
        if (raw === '' || raw.startsWith('//') || raw.startsWith('#')) {
            continue;
        }
        nonCommentLines.push({
            lineIndex: li,
            text: raw,
            tokens: nsc_tokens(raw)
        });
    }

    // Header validation (First 4 non-empty lines)
    if (nonCommentLines.length < 4) {
        const lastLineIdx = Math.max(0, lineCount - 1);
        const lastLine = document.lineAt(lastLineIdx);
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(0, 0, lastLineIdx, lastLine.text.length),
            'NanoSDK project is missing required header lines. First 4 lines must be: DAN [name], DAI [icon], ASM [submenu], TXP [pos].',
            vscode.DiagnosticSeverity.Error
        ));
    } else {
        // Line 1: DAN
        validateHeaderCommand(
            nonCommentLines[0],
            'DAN',
            'DAN [Application Name]',
            'Header Line 1 must define the Application Name (e.g. DAN MyGame).',
            diagnostics
        );

        // Line 2: DAI
        const daiLine = nonCommentLines[1];
        validateHeaderCommand(
            daiLine,
            'DAI',
            'DAI [Asset Name or default]',
            'Header Line 2 must define the Application Icon (e.g. DAI icon.mpi or DAI default).',
            diagnostics
        );
        if (daiLine.tokens.length >= 2 && daiLine.tokens[0].toUpperCase() === 'DAI') {
            const iconParam = daiLine.tokens.slice(1).join(' ');
            validateDaiAsset(daiLine.lineIndex, iconParam, document, diagnostics);
        }

        // Line 3: ASM
        validateHeaderCommand(
            nonCommentLines[2],
            'ASM',
            'ASM [Submenu Name]',
            'Header Line 3 must define the initial Application Submenu (e.g. ASM main).',
            diagnostics
        );

        // Line 4: TXP
        const txpLine = nonCommentLines[3];
        validateHeaderCommand(
            txpLine,
            'TXP',
            'TXP [X Position]',
            'Header Line 4 must define Title X Position (e.g. TXP 020).',
            diagnostics
        );
        if (txpLine.tokens.length >= 2 && txpLine.tokens[0].toUpperCase() === 'TXP') {
            checkNumberPadding(txpLine.lineIndex, txpLine.tokens[1], txpLine.text, warnUnpadded, diagnostics);
        }
    }

    // Body validation & Block matching
    const blockStack: { type: 'IFB' | 'LOP' | 'WHN'; lineIndex: number }[] = [];
    let lgoExpected = 0;
    let lgoOriginLine = -1;

    for (let i = 4; i < nonCommentLines.length; i++) {
        const item = nonCommentLines[i];
        const tk = item.tokens;
        if (tk.length === 0) continue;

        // If currently in LGO string consumption
        if (lgoExpected > 0) {
            lgoExpected--;
            continue;
        }

        const cmd = tk[0].toUpperCase();
        const args = tk.slice(1);

        switch (cmd) {
            case 'PRN':
            case 'END':
            case 'ASM':
                // Valid basic commands
                break;

            case 'IFB': {
                if (args.length === 0) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "IFB requires a condition ('var', 'btn', 'spr') or 'end' / 'els'.", vscode.DiagnosticSeverity.Error));
                    break;
                }
                const sub = args[0].toLowerCase();
                if (sub === 'end') {
                    const top = blockStack.pop();
                    if (!top || top.type !== 'IFB') {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "Unmatched 'IFB end' without an opening IFB block.", vscode.DiagnosticSeverity.Error));
                    }
                } else if (sub === 'els') {
                    const top = blockStack[blockStack.length - 1];
                    if (!top || top.type !== 'IFB') {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "Orphaned 'IFB els' outside of an IFB block.", vscode.DiagnosticSeverity.Error));
                    }
                } else if (sub === 'var') {
                    blockStack.push({ type: 'IFB', lineIndex: item.lineIndex });
                    if (args.length < 4) {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "IFB var syntax: IFB var [variable_name] [eql|mor|les|moe|loe] [value]", vscode.DiagnosticSeverity.Error));
                    } else {
                        validateComparison(item.lineIndex, args[2], item.text, diagnostics);
                        if (warnUnpadded && isNumeric(args[3])) {
                            checkNumberPadding(item.lineIndex, args[3], item.text, warnUnpadded, diagnostics);
                        }
                    }
                } else if (sub === 'btn') {
                    blockStack.push({ type: 'IFB', lineIndex: item.lineIndex });
                    if (args.length < 3) {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "IFB btn syntax: IFB btn [btna|btnb|dpdu|dpdd|dpdl|dpdr] [dwn|ndn]", vscode.DiagnosticSeverity.Error));
                    } else {
                        validateButton(item.lineIndex, args[1], item.text, diagnostics);
                        validateButtonState(item.lineIndex, args[2], item.text, diagnostics);
                    }
                } else if (sub === 'spr') {
                    blockStack.push({ type: 'IFB', lineIndex: item.lineIndex });
                    if (args.length < 4) {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "IFB spr syntax: IFB spr [psx|psy|psz|vsb] [tch|eql|mor|les|moe|loe] [value]", vscode.DiagnosticSeverity.Error));
                    }
                } else {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, `Unknown IFB sub-command '${args[0]}'. Expected 'var', 'btn', 'spr', 'els', or 'end'.`, vscode.DiagnosticSeverity.Error));
                }
                break;
            }

            case 'LOP': {
                if (args.length === 0) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "LOP syntax: LOP [count|inf|ext|end|:blw]", vscode.DiagnosticSeverity.Error));
                    break;
                }
                const sub = args[0].toLowerCase();
                if (sub === 'end') {
                    const top = blockStack.pop();
                    if (!top || top.type !== 'LOP') {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "Unmatched 'LOP end' without an opening LOP block.", vscode.DiagnosticSeverity.Error));
                    }
                } else if (sub === 'ext') {
                    // Loop exit
                } else if (sub === ':blw') {
                    blockStack.push({ type: 'LOP', lineIndex: item.lineIndex });
                    // Condition is on next line
                } else if (sub === 'inf') {
                    blockStack.push({ type: 'LOP', lineIndex: item.lineIndex });
                } else {
                    blockStack.push({ type: 'LOP', lineIndex: item.lineIndex });
                    if (warnUnpadded && isNumeric(args[0])) {
                        checkNumberPadding(item.lineIndex, args[0], item.text, warnUnpadded, diagnostics);
                    }
                }
                break;
            }

            case 'WHN': {
                if (args.length === 0) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "WHN syntax: WHN [sel|btn|var|spr|end] [parameters...]", vscode.DiagnosticSeverity.Error));
                    break;
                }
                const sub = args[0].toLowerCase();
                if (sub === 'end') {
                    const top = blockStack.pop();
                    if (!top || top.type !== 'WHN') {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "Unmatched 'WHN end' without an opening WHN block.", vscode.DiagnosticSeverity.Error));
                    }
                } else if (sub === 'sel') {
                    blockStack.push({ type: 'WHN', lineIndex: item.lineIndex });
                    if (args.length < 2) {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "WHN sel requires 1-based index parameter (e.g. WHN sel 001).", vscode.DiagnosticSeverity.Error));
                    } else if (warnUnpadded && isNumeric(args[1])) {
                        checkNumberPadding(item.lineIndex, args[1], item.text, warnUnpadded, diagnostics);
                    }
                } else if (sub === 'btn') {
                    blockStack.push({ type: 'WHN', lineIndex: item.lineIndex });
                    if (args.length < 3) {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "WHN btn syntax: WHN btn [button] [state]", vscode.DiagnosticSeverity.Error));
                    } else {
                        validateButton(item.lineIndex, args[1], item.text, diagnostics);
                        validateButtonState(item.lineIndex, args[2], item.text, diagnostics);
                    }
                } else if (sub === 'var') {
                    blockStack.push({ type: 'WHN', lineIndex: item.lineIndex });
                    if (args.length < 4) {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "WHN var syntax: WHN var [variable] [cmp] [value]", vscode.DiagnosticSeverity.Error));
                    } else {
                        validateComparison(item.lineIndex, args[2], item.text, diagnostics);
                        if (warnUnpadded && isNumeric(args[3])) {
                            checkNumberPadding(item.lineIndex, args[3], item.text, warnUnpadded, diagnostics);
                        }
                    }
                } else if (sub === 'spr') {
                    blockStack.push({ type: 'WHN', lineIndex: item.lineIndex });
                } else {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, `Unknown WHN event '${args[0]}'. Expected 'sel', 'btn', 'var', 'spr', or 'end'.`, vscode.DiagnosticSeverity.Error));
                }
                break;
            }

            case 'CLG': {
                if (args.length > 0) {
                    const preset = args[0].toLowerCase();
                    if (preset !== 'ful' && preset !== 'scl') {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, `Invalid CLG preset '${args[0]}'. Allowed presets: 'ful' (fullscreen) or 'scl' (scrollable).`, vscode.DiagnosticSeverity.Warning));
                    }
                }
                break;
            }

            case 'LGP':
            case 'LGD': {
                if (args.length < 2) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, `${cmd} requires 2 numeric parameters (e.g. ${cmd} 080 058).`, vscode.DiagnosticSeverity.Error));
                } else {
                    if (warnUnpadded) {
                        if (isNumeric(args[0])) checkNumberPadding(item.lineIndex, args[0], item.text, warnUnpadded, diagnostics);
                        if (isNumeric(args[1])) checkNumberPadding(item.lineIndex, args[1], item.text, warnUnpadded, diagnostics);
                    }
                }
                break;
            }

            case 'LGO': {
                if (args.length < 1 || !args[0].toLowerCase().startsWith('str')) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "LGO requires 'strN' parameter (e.g. LGO str3).", vscode.DiagnosticSeverity.Error));
                } else {
                    const num = parseInt(args[0].toLowerCase().substring(3), 10);
                    if (isNaN(num) || num <= 0) {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, "LGO count must be a positive integer (e.g. LGO str3).", vscode.DiagnosticSeverity.Error));
                    } else {
                        lgoExpected = num;
                        lgoOriginLine = item.lineIndex;
                    }
                }
                break;
            }

            case 'LGS': {
                if (args.length < 2) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "LGS requires 0-based index and text (e.g. LGS 000 Item Title).", vscode.DiagnosticSeverity.Error));
                } else if (warnUnpadded && isNumeric(args[0])) {
                    checkNumberPadding(item.lineIndex, args[0], item.text, warnUnpadded, diagnostics);
                }
                break;
            }

            case 'LGV': {
                if (args.length < 2) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "LGV requires 0-based index and variable name (e.g. LGV 000 selectedText).", vscode.DiagnosticSeverity.Error));
                } else if (warnUnpadded && isNumeric(args[0])) {
                    checkNumberPadding(item.lineIndex, args[0], item.text, warnUnpadded, diagnostics);
                }
                break;
            }

            case 'LGR': {
                if (args.length < 1) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "LGR requires 0-based index (e.g. LGR 000).", vscode.DiagnosticSeverity.Error));
                } else if (warnUnpadded && isNumeric(args[0])) {
                    checkNumberPadding(item.lineIndex, args[0], item.text, warnUnpadded, diagnostics);
                }
                break;
            }

            case 'DLG':
                break;

            case 'LGH': {
                if (args.length < 1) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "LGH requires mode: 'off', 'auto', or 0-based index.", vscode.DiagnosticSeverity.Error));
                } else {
                    const mode = args[0].toLowerCase();
                    if (mode !== 'off' && mode !== 'auto' && !isNumeric(mode)) {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, `Invalid LGH mode '${args[0]}'. Allowed: 'off', 'auto', or 0-based index.`, vscode.DiagnosticSeverity.Warning));
                    }
                }
                break;
            }

            case 'LGT': {
                if (args.length < 1) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "LGT requires theme mode: 'd' (dark), 'l' (light), or 'm' (match system).", vscode.DiagnosticSeverity.Error));
                } else {
                    const theme = args[0].toLowerCase();
                    if (theme !== 'd' && theme !== 'l' && theme !== 'm') {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, `Invalid LGT theme '${args[0]}'. Allowed: 'd', 'l', or 'm'.`, vscode.DiagnosticSeverity.Warning));
                    }
                }
                break;
            }

            case 'LSB': {
                if (args.length < 1) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "LSB requires 'on' or 'off'.", vscode.DiagnosticSeverity.Error));
                } else {
                    const mode = args[0].toLowerCase();
                    if (mode !== 'on' && mode !== 'off') {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, `Invalid LSB state '${args[0]}'. Expected 'on' or 'off'.`, vscode.DiagnosticSeverity.Warning));
                    }
                }
                break;
            }

            case 'DVR':
            case 'SVR': {
                if (args.length < 2) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, `${cmd} requires variable name and initial/new value (e.g. ${cmd} score 000).`, vscode.DiagnosticSeverity.Error));
                } else {
                    if (/^[0-9]/.test(args[0])) {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, `${cmd} variable name '${args[0]}' cannot start with a digit.`, vscode.DiagnosticSeverity.Error));
                    }
                    if (warnUnpadded && isNumeric(args[1])) {
                        checkNumberPadding(item.lineIndex, args[1], item.text, warnUnpadded, diagnostics);
                    }
                }
                break;
            }

            case 'VRM': {
                if (args.length < 3) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "VRM requires: [var_name] [add|sub|mul|div] [number] (e.g. VRM count add 001).", vscode.DiagnosticSeverity.Error));
                } else {
                    if (/^[0-9]/.test(args[0])) {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, `VRM variable name '${args[0]}' cannot start with a digit.`, vscode.DiagnosticSeverity.Error));
                    }
                    const op = args[1].toLowerCase();
                    if (op !== 'add' && op !== 'sub' && op !== 'mul' && op !== 'div') {
                        diagnostics.push(createLineDiag(item.lineIndex, item.text, `Invalid VRM operator '${args[1]}'. Allowed operations: 'add', 'sub', 'mul', 'div'.`, vscode.DiagnosticSeverity.Error));
                    }
                    if (warnUnpadded && isNumeric(args[2])) {
                        checkNumberPadding(item.lineIndex, args[2], item.text, warnUnpadded, diagnostics);
                    }
                }
                break;
            }

            case 'VCJ': {
                if (args.length < 2) {
                    diagnostics.push(createLineDiag(item.lineIndex, item.text, "VCJ requires variable name and text/variable to join (e.g. VCJ greeting World).", vscode.DiagnosticSeverity.Error));
                }
                break;
            }

            default: {
                const knownCommands = [
                    'PRN', 'END', 'ASM', 'IFB', 'LOP', 'WHN',
                    'CLG', 'LGP', 'LGD', 'LGO', 'LGS', 'LGV', 'LGR', 'DLG', 'LGH', 'LGT', 'LSB',
                    'DVR', 'SVR', 'VRM', 'VCJ'
                ];
                // Check for close matches (typos)
                const suggestion = findClosestCommand(cmd, knownCommands);
                const suggestionText = suggestion ? ` Did you mean '${suggestion}'?` : '';
                diagnostics.push(createLineDiag(
                    item.lineIndex,
                    item.text,
                    `Unknown command '${cmd}'. This command does not exist in NanoSDK (2026.x).${suggestionText}`,
                    vscode.DiagnosticSeverity.Error
                ));
                break;
            }
        }
    }

    if (lgoExpected > 0) {
        diagnostics.push(createLineDiag(
            lgoOriginLine,
            document.lineAt(lgoOriginLine).text,
            `LGO expected ${lgoExpected} more menu option line(s) before end of file.`,
            vscode.DiagnosticSeverity.Error
        ));
    }

    // Check unclosed blocks
    for (const unclosed of blockStack) {
        diagnostics.push(createLineDiag(
            unclosed.lineIndex,
            document.lineAt(unclosed.lineIndex).text,
            `Unclosed ${unclosed.type} block. Missing '${unclosed.type} end'.`,
            vscode.DiagnosticSeverity.Error
        ));
    }

    collection.set(document.uri, diagnostics);
}

function validateHeaderCommand(
    line: { lineIndex: number; text: string; tokens: string[] },
    expectedCmd: string,
    usage: string,
    message: string,
    diagnostics: vscode.Diagnostic[]
) {
    if (line.tokens.length === 0 || line.tokens[0].toUpperCase() !== expectedCmd) {
        diagnostics.push(createLineDiag(line.lineIndex, line.text, message, vscode.DiagnosticSeverity.Error));
    } else if (line.tokens.length < 2) {
        diagnostics.push(createLineDiag(line.lineIndex, line.text, `Missing parameter for ${expectedCmd}. Expected: ${usage}`, vscode.DiagnosticSeverity.Error));
    }
}

function validateDaiAsset(
    lineIndex: number,
    iconParam: string,
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[]
) {
    if (!iconParam || iconParam.toLowerCase() === 'default') {
        return;
    }

    const docDir = path.dirname(document.uri.fsPath);
    const resolvedPath = path.join(docDir, iconParam);

    if (!fs.existsSync(resolvedPath)) {
        // Also check with extensions
        if (!fs.existsSync(resolvedPath + '.mpi') && !fs.existsSync(resolvedPath + '.wrt')) {
            const diag = createLineDiag(
                lineIndex,
                document.lineAt(lineIndex).text,
                `Icon asset '${iconParam}' was not found in directory '${docDir}'. Create the icon or use 'DAI default'.`,
                vscode.DiagnosticSeverity.Warning
            );
            diag.code = 'ICON_NOT_FOUND';
            diagnostics.push(diag);
        }
    }
}

function validateComparison(
    lineIndex: number,
    cmp: string,
    lineText: string,
    diagnostics: vscode.Diagnostic[]
) {
    const valid = ['eql', 'mor', 'les', 'moe', 'loe', 'tch', '=', '>', '<', '>=', '<=', '=='];
    if (!valid.includes(cmp.toLowerCase())) {
        diagnostics.push(createLineDiag(lineIndex, lineText, `Invalid comparison '${cmp}'. Allowed: 'eql', 'mor', 'les', 'moe', 'loe'.`, vscode.DiagnosticSeverity.Error));
    }
}

function validateButton(
    lineIndex: number,
    btn: string,
    lineText: string,
    diagnostics: vscode.Diagnostic[]
) {
    const valid = ['btna', 'btnb', 'dpdu', 'dpdd', 'dpdl', 'dpdr'];
    if (!valid.includes(btn.toLowerCase())) {
        diagnostics.push(createLineDiag(lineIndex, lineText, `Invalid button '${btn}'. Allowed: btna, btnb, dpdu, dpdd, dpdl, dpdr.`, vscode.DiagnosticSeverity.Error));
    }
}

function validateButtonState(
    lineIndex: number,
    state: string,
    lineText: string,
    diagnostics: vscode.Diagnostic[]
) {
    const valid = ['dwn', 'ndn'];
    if (!valid.includes(state.toLowerCase())) {
        diagnostics.push(createLineDiag(lineIndex, lineText, `Invalid button state '${state}'. Allowed: 'dwn' (down/pressed) or 'ndn' (not down).`, vscode.DiagnosticSeverity.Error));
    }
}

function checkNumberPadding(
    lineIndex: number,
    numStr: string,
    lineText: string,
    warnUnpadded: boolean,
    diagnostics: vscode.Diagnostic[]
) {
    if (!warnUnpadded) return;
    const n = parseInt(numStr, 10);
    if (!isNaN(n)) {
        const absVal = Math.abs(n);
        if (absVal < 100 && numStr.length < 3 && !numStr.startsWith('-0')) {
            const padPfx = n < 0 ? (absVal < 10 ? '-0' : '-') : (absVal < 10 ? '00' : '0');
            const padded = padPfx + absVal;
            const startIdx = lineText.indexOf(numStr);
            const range = startIdx !== -1
                ? new vscode.Range(lineIndex, startIdx, lineIndex, startIdx + numStr.length)
                : new vscode.Range(lineIndex, 0, lineIndex, lineText.length);
            const diag = new vscode.Diagnostic(
                range,
                `Number '${numStr}' should be padded to 3 digits in NanoSDK (e.g. '${padded}').`,
                vscode.DiagnosticSeverity.Information
            );
            diag.code = 'PAD_NUMBER';
            diagnostics.push(diag);
        }
    }
}

function isNumeric(str: string): boolean {
    return /^-?\d+$/.test(str.trim());
}

function createLineDiag(
    lineIndex: number,
    lineText: string,
    message: string,
    severity: vscode.DiagnosticSeverity
): vscode.Diagnostic {
    const range = new vscode.Range(lineIndex, 0, lineIndex, lineText.length);
    return new vscode.Diagnostic(range, message, severity);
}

function levenshteinDistance(a: string, b: string): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[a.length][b.length];
}

function findClosestCommand(cmd: string, knownCommands: string[]): string | undefined {
    const upperCmd = cmd.toUpperCase();
    let best: string | undefined;
    let bestDistance = Infinity;
    for (const known of knownCommands) {
        const distance = levenshteinDistance(upperCmd, known);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = known;
        }
    }
    return bestDistance <= 2 ? best : undefined;
}
