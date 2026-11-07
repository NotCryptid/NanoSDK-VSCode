import * as fs from 'fs';
import * as path from 'path';

export interface CompileResult {
    success: boolean;
    nsaContent?: string;
    errors: string[];
    warnings: string[];
    metadata?: {
        appName: string;
        icon: string;
        submenu: string;
        txp: string;
        instructionCount: number;
    };
}

export type IconResolver = (iconParam: string) => Promise<string> | string;

/**
 * NanoSDK Compiler
 * Faithfully compiles NanoSDK (.nsp) code to MicroOS Application (.nsa) binary.
 * Reference: https://github.com/NotCryptid/MicroOS/blob/master/src/compiler.ts
 */
export async function compileNanoSDK(
    source: string,
    options?: {
        sourceFilePath?: string;
        iconResolver?: IconResolver;
    }
): Promise<CompileResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for illegal characters in MicroOS format
    if (source.includes('~')) {
        warnings.push("Source contains '~' which is a reserved delimiter in MicroOS binary format.");
    }
    if (source.includes('§')) {
        warnings.push("Source contains '§' which is a reserved opcode delimiter in MicroOS binary format.");
    }

    // Split lines by newline or MicroOS tilde
    const raw = source.split(/\r?\n|~/);
    const lines: string[] = [];

    // MARK: Pass 1 - :BLW resolution
    let i = 0;
    while (i < raw.length) {
        let l = raw[i].trim();
        // Remove full line comments
        if (l.startsWith('//') || l.startsWith('#')) {
            i++;
            continue;
        }
        if (l === '' || l === ' ') {
            i++;
            continue;
        }

        const isLopBlw = l.toUpperCase() === 'LOP :BLW';
        if (i >= 4 && !isLopBlw && l.toUpperCase().endsWith(':BLW')) {
            const base = l.substring(0, l.length - 4).trim();
            i++;
            while (i < raw.length && (raw[i].trim() === '' || raw[i].trim().startsWith('//') || raw[i].trim().startsWith('#'))) {
                i++;
            }
            lines.push(i < raw.length ? base + ' ' + raw[i++].trim() : base);
        } else {
            lines.push(l);
            i++;
        }
    }

    // MARK: Pass 2 - Header
    if (lines.length < 4) {
        errors.push('NanoSDK project must have at least 4 header lines: DAN, DAI, ASM, TXP.');
        return { success: false, errors, warnings };
    }

    const t0 = nsc_tokens(lines[0]);
    const t1 = nsc_tokens(lines[1]);
    const t2 = nsc_tokens(lines[2]);
    const t3 = nsc_tokens(lines[3]);

    if (t0.length === 0 || t0[0].toUpperCase() !== 'DAN') {
        errors.push(`Header Line 1 must be 'DAN [app name]', got: '${lines[0]}'`);
    }
    if (t1.length === 0 || t1[0].toUpperCase() !== 'DAI') {
        errors.push(`Header Line 2 must be 'DAI [icon asset or default]', got: '${lines[1]}'`);
    }
    if (t2.length === 0 || t2[0].toUpperCase() !== 'ASM') {
        errors.push(`Header Line 3 must be 'ASM [submenu name]', got: '${lines[2]}'`);
    }
    if (t3.length === 0 || t3[0].toUpperCase() !== 'TXP') {
        errors.push(`Header Line 4 must be 'TXP [x position]', got: '${lines[3]}'`);
    }

    if (errors.length > 0) {
        return { success: false, errors, warnings };
    }

    const appName = t0.slice(1).join(' ');
    const iconParam = t1.slice(1).join(' ');
    const subMenu = t2.slice(1).join(' ');
    const txp = nsc_pad(t3[1] || '020');

    // Resolve icon
    let iconHex = 'default';
    if (options?.iconResolver) {
        try {
            iconHex = await options.iconResolver(iconParam);
        } catch (err: any) {
            warnings.push(`Could not resolve icon '${iconParam}': ${err.message || err}. Falling back to default.`);
            iconHex = 'default';
        }
    } else {
        iconHex = resolveLocalIconSync(iconParam, options?.sourceFilePath, warnings);
    }

    const hdr = [appName, iconHex, subMenu, txp];

    // MARK: Pass 3 - Body
    const out: string[] = [];
    const body = lines.slice(4);
    let lgoN = 0;
    let lgoA: string[] = [];

    for (let li = 0; li < body.length; li++) {
        const l = body[li];

        // MARK: LGO string consumption
        if (lgoN > 0) {
            lgoA.push(l);
            lgoN--;
            if (lgoN === 0) {
                out.push('304§' + lgoA.join('§'));
                lgoA = [];
            }
            continue;
        }

        const tk = nsc_tokens(l);
        if (tk.length === 0) {
            continue;
        }

        const cmd = tk[0].toUpperCase();
        const a = tk.slice(1);

        switch (cmd) {
            // MARK: Basic Commands
            case 'PRN':
                out.push('105§' + a.join(' '));
                continue;
            case 'END':
                out.push('106§' + a.join(' '));
                continue;
            case 'ASM':
                out.push('107§' + a.join(' '));
                continue;

            // MARK: Logic — IFB and WHN share the same condition encoding
            case 'IFB':
            case 'WHN': {
                if (a.length === 0) {
                    errors.push(`Line ${li + 5}: ${cmd} requires arguments (e.g. 'var', 'btn', 'spr', 'end').`);
                    break;
                }
                const pfx = cmd === 'IFB' ? '201' : '401';
                const ac = a[0].toLowerCase();
                switch (ac) {
                    case 'end':
                        out.push(pfx + '§e');
                        continue;
                    case 'els':
                        out.push(pfx + '§l');
                        continue;
                    case 'var':
                        if (a.length < 3) {
                            errors.push(`Line ${li + 5}: ${cmd} var requires: var_name comparison value`);
                            break;
                        }
                        out.push(pfx + '§v§' + a[1] + '§' + nsc_cmp(a[2]) + '§' + a.slice(3).join(' '));
                        continue;
                    case 'btn':
                        if (a.length < 3) {
                            errors.push(`Line ${li + 5}: ${cmd} btn requires: button state (e.g. btna dwn)`);
                            break;
                        }
                        out.push(pfx + '§b§' + nsc_btn(a[1]) + '§' + nsc_bs(a[2]));
                        continue;
                    case 'spr':
                        if (a.length < 3) {
                            errors.push(`Line ${li + 5}: ${cmd} spr requires: sprite_property comparison value`);
                            break;
                        }
                        out.push(pfx + '§s§' + a[1] + '§' + (a[2].toLowerCase() === 'tch' ? 'tch' : nsc_cmp(a[2])) + '§' + a.slice(3).join(' '));
                        continue;
                    case 'sel':
                        if (cmd === 'WHN' && a.length >= 2) {
                            out.push('401§sel§' + nsc_pad(a[1]));
                            continue;
                        }
                        errors.push(`Line ${li + 5}: WHN sel requires 1-based index (e.g. WHN sel 001)`);
                        break;
                }
                break;
            }

            // MARK: Loop
            case 'LOP': {
                const p = a.length > 0 ? a[0].toLowerCase() : '';
                switch (p) {
                    case 'end':
                        out.push('202§e');
                        continue;
                    case 'ext':
                        out.push('202§x');
                        continue;
                    case 'inf':
                        out.push('202§inf');
                        continue;
                    case ':blw': {
                        // LOP :BLW — next line is the condition (IFB btn/var/spr)
                        li++;
                        if (li < body.length) {
                            const ctk = nsc_tokens(body[li]);
                            const cac = ctk.length > 1 ? ctk[1].toLowerCase() : '';
                            const ca = ctk.slice(2);
                            let condStr = '';
                            switch (cac) {
                                case 'btn':
                                    if (ca.length >= 2) {
                                        condStr = 'b§' + nsc_btn(ca[0]) + '§' + nsc_bs(ca[1]);
                                    }
                                    break;
                                case 'var':
                                    if (ca.length >= 2) {
                                        condStr = 'v§' + ca[0] + '§' + nsc_cmp(ca[1]) + '§' + ca.slice(2).join(' ');
                                    }
                                    break;
                                case 'spr':
                                    if (ca.length >= 2) {
                                        condStr = 's§' + ca[0] + '§' + (ca[1].toLowerCase() === 'tch' ? 'tch' : nsc_cmp(ca[1])) + '§' + ca.slice(2).join(' ');
                                    }
                                    break;
                            }
                            if (condStr !== '') {
                                out.push('202§BLW§' + condStr);
                            } else {
                                errors.push(`Line ${li + 5}: LOP :BLW expected valid IFB condition on next line.`);
                            }
                        } else {
                            errors.push(`Line ${li + 5}: LOP :BLW requires condition line below.`);
                        }
                        continue;
                    }
                    default: {
                        const parsed = parseInt(p, 10);
                        if (isNaN(parsed)) {
                            warnings.push(`Line ${li + 5}: Invalid loop parameter '${p}'. Defaulting to loop 0.`);
                            out.push('202§0');
                        } else {
                            out.push('202§' + parsed.toString());
                        }
                        continue;
                    }
                }
            }

            // MARK: ListGUI
            case 'CLG': {
                const p = a.length > 0 ? a[0].toLowerCase() : '';
                const enc = p === 'ful' ? 'f' : p === 'scl' ? 's' : '';
                out.push(enc ? '301§' + enc : '301');
                continue;
            }
            case 'LGP':
                if (a.length < 2) {
                    errors.push(`Line ${li + 5}: LGP requires X and Y parameters.`);
                    break;
                }
                if (!isCompilerNumericOrRef(a[0]) || !isCompilerNumericOrRef(a[1])) {
                    errors.push(`Line ${li + 5}: LGP X and Y parameters must be numbers (e.g. LGP 080 058).`);
                    break;
                }
                out.push('302§' + nsc_pad(a[0]) + '§' + nsc_pad(a[1]));
                continue;
            case 'LGD':
                if (a.length < 2) {
                    errors.push(`Line ${li + 5}: LGD requires Width and Height parameters.`);
                    break;
                }
                if (!isCompilerNumericOrRef(a[0]) || !isCompilerNumericOrRef(a[1])) {
                    errors.push(`Line ${li + 5}: LGD Width and Height parameters must be numbers (e.g. LGD 160 097).`);
                    break;
                }
                out.push('303§' + nsc_pad(a[0]) + '§' + nsc_pad(a[1]));
                continue;
            case 'LGO':
                if (a.length < 1) {
                    errors.push(`Line ${li + 5}: LGO requires option count (e.g. str3).`);
                    break;
                }
                lgoN = parseInt(a[0].toLowerCase().substring(3), 10) || 0;
                lgoA = [];
                continue;
            case 'LGS':
                if (a.length < 1) {
                    errors.push(`Line ${li + 5}: LGS requires index and text.`);
                    break;
                }
                out.push('305§' + nsc_pad(a[0]) + '§' + a.slice(1).join(' '));
                continue;
            case 'LGV':
                if (a.length < 2) {
                    errors.push(`Line ${li + 5}: LGV requires index and variable name.`);
                    break;
                }
                out.push('306§' + nsc_pad(a[0]) + '§' + a[1]);
                continue;
            case 'LGR':
                if (a.length < 1) {
                    errors.push(`Line ${li + 5}: LGR requires index.`);
                    break;
                }
                out.push('307§' + nsc_pad(a[0]));
                continue;
            case 'DLG':
                out.push('308');
                continue;
            case 'LGH': {
                if (a.length < 1) {
                    errors.push(`Line ${li + 5}: LGH requires mode (off, auto, or index).`);
                    break;
                }
                const m = a[0].toLowerCase();
                out.push('309§' + (m === 'off' ? 'o' : m === 'auto' ? 'a' : parseInt(m, 10).toString()));
                continue;
            }
            case 'LGT':
                if (a.length < 1) {
                    errors.push(`Line ${li + 5}: LGT requires theme ('d', 'l', 'm').`);
                    break;
                }
                out.push('310§' + a[0].toLowerCase());
                continue;
            case 'LSB': {
                if (a.length < 1) {
                    errors.push(`Line ${li + 5}: LSB requires 'on' or 'off'.`);
                    break;
                }
                const m = a[0].toLowerCase();
                out.push('311§' + (m === 'on' ? 't' : 'f'));
                continue;
            }

            // MARK: Variables
            case 'DVR':
                if (a.length < 2) {
                    errors.push(`Line ${li + 5}: DVR requires variable name and initial value.`);
                    break;
                }
                if (/^[0-9]/.test(a[0])) {
                    errors.push(`Line ${li + 5}: DVR variable name '${a[0]}' cannot start with a digit.`);
                    break;
                }
                out.push('501§' + nsc_pad(a[0]) + '§' + nsc_pad(a[1]));
                continue;
            case 'SVR':
                if (a.length < 2) {
                    errors.push(`Line ${li + 5}: SVR requires variable name and new value.`);
                    break;
                }
                if (/^[0-9]/.test(a[0])) {
                    errors.push(`Line ${li + 5}: SVR variable name '${a[0]}' cannot start with a digit.`);
                    break;
                }
                out.push('502§' + nsc_pad(a[0]) + '§' + nsc_pad(a[1]));
                continue;
            case 'VRM':
                if (a.length < 3) {
                    errors.push(`Line ${li + 5}: VRM requires variable name, operation (add/sub/mul/div), and value.`);
                    break;
                }
                if (/^[0-9]/.test(a[0])) {
                    errors.push(`Line ${li + 5}: VRM variable name '${a[0]}' cannot start with a digit.`);
                    break;
                }
                {
                    const op = a[1].toLowerCase();
                    if (op !== 'add' && op !== 'sub' && op !== 'mul' && op !== 'div') {
                        errors.push(`Line ${li + 5}: VRM invalid operation '${a[1]}'. Must be 'add', 'sub', 'mul', or 'div'.`);
                        break;
                    }
                    if (!isCompilerNumericOrRef(a[2])) {
                        errors.push(`Line ${li + 5}: VRM value '${a[2]}' must be a number or variable reference (!var!).`);
                        break;
                    }
                    out.push('503§' + nsc_pad(a[0]) + '§' + nsc_op(op) + '§' + nsc_pad(a[2]));
                    continue;
                }
            case 'VCJ':
                if (a.length < 1) {
                    errors.push(`Line ${li + 5}: VCJ requires variable name and text/variable to append.`);
                    break;
                }
                out.push('504§' + nsc_pad(a[0]) + '§' + a.slice(1).join(' '));
                continue;
        }

        // Unknown / unhandled command — this is an error, not a warning
        errors.push(`Line ${li + 5}: Unknown command '${cmd}'. This command does not exist in NanoSDK.`);
    }

    if (lgoN > 0) {
        errors.push(`LGO expected ${lgoN} more option line(s) before end of file.`);
    }

    const nsaContent = hdr.concat(out).join('~');

    return {
        success: errors.length === 0,
        nsaContent,
        errors,
        warnings,
        metadata: {
            appName,
            icon: iconHex,
            submenu: subMenu,
            txp,
            instructionCount: out.length
        }
    };
}

/**
 * Resolves icon from local file (.mpi or .wrt or hex string)
 */
export function resolveLocalIconSync(
    iconParam: string,
    sourceFilePath?: string,
    warnings?: string[]
): string {
    if (!iconParam || iconParam.toLowerCase() === 'default') {
        return 'default';
    }

    // Direct 64 hex character string
    const hexClean = iconParam.replace(/[\s\r\n~]+/g, '').toUpperCase();
    if (hexClean.length === 64 && /^[0-9A-F]{64}$/.test(hexClean)) {
        return hexClean;
    }

    // Try resolving file
    const searchDirs: string[] = [];
    if (sourceFilePath) {
        searchDirs.push(path.dirname(sourceFilePath));
    }
    searchDirs.push(process.cwd());

    let foundPath: string | null = null;
    for (const dir of searchDirs) {
        const direct = path.join(dir, iconParam);
        if (fs.existsSync(direct)) {
            foundPath = direct;
            break;
        }
        // Try appending .mpi or .wrt if not present
        if (!iconParam.includes('.')) {
            if (fs.existsSync(direct + '.mpi')) {
                foundPath = direct + '.mpi';
                break;
            }
            if (fs.existsSync(direct + '.wrt')) {
                foundPath = direct + '.wrt';
                break;
            }
        }
    }

    if (!foundPath) {
        warnings?.push(`Icon file '${iconParam}' not found. Using default icon.`);
        return 'default';
    }

    try {
        const raw = fs.readFileSync(foundPath, 'utf8');
        const parsed = parseIconFileContent(raw);
        if (parsed.length === 64) {
            return parsed;
        }
        warnings?.push(`Icon in '${foundPath}' had ${parsed.length} pixels instead of 64. Using default.`);
        return 'default';
    } catch (err: any) {
        warnings?.push(`Error reading icon '${foundPath}': ${err.message}. Using default.`);
        return 'default';
    }
}

/**
 * Parses icon content (.mpi or .wrt) into a flat 64 hex character string
 */
export function parseIconFileContent(content: string): string {
    const lines = content.split(/\r?\n|~/);
    let hex = '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
            continue;
        }
        for (let i = 0; i < trimmed.length; i++) {
            const ch = trimmed.charAt(i).toUpperCase();
            if (/[0-9A-F]/.test(ch)) {
                hex += ch;
            }
        }
    }
    return hex;
}

export function nsc_tokens(line: string): string[] {
    const parts: string[] = [];
    let cur = '';
    for (let ci = 0; ci < line.length; ci++) {
        const ch = line.charAt(ci);
        if (ch === ' ' || ch === '\t') {
            if (cur !== '') {
                parts.push(cur);
                cur = '';
            }
        } else {
            cur += ch;
        }
    }
    if (cur !== '') {
        parts.push(cur);
    }
    return parts;
}

export function nsc_cmp(s: string): string {
    const c = s.toLowerCase();
    switch (c) {
        case 'eql': return '=';
        case 'mor': return '>';
        case 'les': return '<';
        case 'moe': return '≥';
        case 'loe': return '≤';
        default: return s;
    }
}

export function nsc_btn(s: string): string {
    const b = s.toLowerCase();
    switch (b) {
        case 'btna': return 'a';
        case 'btnb': return 'b';
        case 'dpdu': return 'u';
        case 'dpdd': return 'd';
        case 'dpdl': return 'l';
        case 'dpdr': return 'r';
        default: return b;
    }
}

export function nsc_bs(s: string): string {
    switch (s.toLowerCase()) {
        case 'dwn': return 't';
        case 'ndn': return 'f';
        default: return s;
    }
}

export function nsc_pad(s: string): string {
    const n = parseInt(s, 10);
    if (isNaN(n)) {
        return s;
    }
    if (Math.abs(n) < 10) {
        return (n < 0 ? '-0' : '00') + Math.abs(n);
    }
    if (Math.abs(n) < 100) {
        return (n < 0 ? '-' : '0') + Math.abs(n);
    }
    return n.toString();
}

/**
 * Checks if a string is a valid numeric value or a variable reference (!var! or !var).
 * Used for type checking command arguments that expect numeric values.
 */
export function isCompilerNumericOrRef(s: string): boolean {
    if (/^-?\d+$/.test(s)) return true;          // plain number
    if (s.startsWith('!')) return true;            // variable reference (!var! or !var)
    return false;
}

export function nsc_op(s: string): string {
    switch (s.toLowerCase()) {
        case 'add': return 'a';
        case 'sub': return 's';
        case 'mul': return 'm';
        case 'div': return 'd';
        default: return s;
    }
}
