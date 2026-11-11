import {
    CompileResult,
    IconResolver,
    resolveLocalIconSync,
    nsc_tokens,
    nsc_cmp,
    nsc_btn,
    nsc_bs,
    nsc_op
} from './compiler';
import { FONT8_CHAR_WIDTH, FONT8_HEX } from './font8';

/**
 * NanoSDK 2027.1 Packager
 * Mirror of MicroOS src/packager.ts + nanoSDK_decode (src/nanosdk_runtime.ts).
 *
 * Not a compiler: the app body ships as plain NanoSDK source and MicroOS
 * decodes it when the app opens. The packager validates the 3-line header
 * (DAN, DAI, ASM), bakes the DAI icon in, works out the title X position and
 * strips blank lines / comments / indentation.
 *
 * Package format: name~icon~submenu~titleX~<source line>~<source line>...
 */
export async function packageNanoSDK(
    source: string,
    options?: {
        sourceFilePath?: string;
        iconResolver?: IconResolver;
    }
): Promise<CompileResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (source.includes('~')) {
        warnings.push("Source contains '~' which is the reserved line delimiter in the MicroOS package format.");
    }

    // Split on newlines or MicroOS tildes; drop blanks and full-line comments.
    // Remember each line's 1-based position in the original text for errors.
    const lines: { text: string; no: number }[] = [];
    const rawLines = source.split(/\r?\n/);
    for (let n = 0; n < rawLines.length; n++) {
        for (const part of rawLines[n].split('~')) {
            const l = part.trim();
            if (l === '' || l.startsWith('//') || l.startsWith('#')) { continue; }
            lines.push({ text: l, no: n + 1 });
        }
    }

    // MARK: Header
    if (lines.length < 3) {
        errors.push('NanoSDK project must have at least 3 header lines: DAN, DAI, ASM.');
        return { success: false, errors, warnings };
    }
    const t0 = nsc_tokens(lines[0].text);
    const t1 = nsc_tokens(lines[1].text);
    const t2 = nsc_tokens(lines[2].text);
    if (t0.length === 0 || t0[0].toUpperCase() !== 'DAN') {
        errors.push(`Header Line 1 must be 'DAN [app name]', got: '${lines[0].text}'`);
    }
    if (t1.length === 0 || t1[0].toUpperCase() !== 'DAI') {
        errors.push(`Header Line 2 must be 'DAI [icon asset or default]', got: '${lines[1].text}'`);
    }
    if (t2.length === 0 || t2[0].toUpperCase() !== 'ASM') {
        errors.push(`Header Line 3 must be 'ASM [submenu name]', got: '${lines[2].text}'`);
    }
    if (errors.length > 0) {
        return { success: false, errors, warnings };
    }

    const appName = t0.slice(1).join(' ');
    const iconParam = t1.slice(1).join(' ');
    const subMenu = t2.slice(1).join(' ');

    let iconHex = 'default';
    if (options?.iconResolver) {
        try {
            iconHex = await options.iconResolver(iconParam);
        } catch (err: any) {
            warnings.push(`Could not resolve icon '${iconParam}': ${err.message || err}. Falling back to default.`);
        }
    } else {
        iconHex = resolveLocalIconSync(iconParam, options?.sourceFilePath, warnings);
    }

    // Older projects carry a TXP line as the 4th header line; it is ignored now.
    let bodyStart = 3;
    if (lines.length > 3 && lines[3].text.substr(0, 3).toUpperCase() === 'TXP') {
        bodyStart = 4;
        warnings.push("'TXP' is ignored in 2027.1 (the title position is calculated automatically). You can remove it.");
    }

    const body = lines.slice(bodyStart);
    const bodyText = body.map(l => l.text);

    // MARK: Validation (same decoder MicroOS runs when an app opens)
    const decoded = decodeNanoSDK(bodyText);
    for (const idx of decoded.invalid) {
        const ln = body[Math.min(idx, body.length - 1)];
        errors.push(ln
            ? `Line ${ln.no}: invalid or malformed command '${ln.text}' (MicroOS error 301).`
            : 'Invalid or malformed command (MicroOS error 301).');
    }
    if (errors.length > 0) {
        return { success: false, errors, warnings };
    }

    const titleX = nsc_title_x(appName);
    const hdr = [appName, iconHex, subMenu, titleX.toString()];
    return {
        success: true,
        nsaContent: hdr.concat(bodyText).join('~'),
        errors,
        warnings,
        metadata: {
            appName,
            icon: iconHex,
            submenu: subMenu,
            txp: titleX.toString(),
            instructionCount: decoded.program.length
        }
    };
}

// MARK: Title X Position
// MicroOS places an app title (a textsprite, centred) so the first visible
// pixel of the first letter lands on x = 1. Glyphs have blank leading columns
// that vary per letter, so this reads the real font8 data.
let glyphLead: Map<number, number> | null = null;

function loadGlyphLead(): Map<number, number> {
    if (glyphLead) { return glyphLead; }
    glyphLead = new Map();
    const rowHex = (FONT8_CHAR_WIDTH + 2) * 2;
    for (let off = 0; off + rowHex <= FONT8_HEX.length; off += rowHex) {
        const code = parseInt(FONT8_HEX.substr(off + 2, 2) + FONT8_HEX.substr(off, 2), 16);
        let lead = 0;
        for (let col = 0; col < FONT8_CHAR_WIDTH; col++) {
            if (FONT8_HEX.substr(off + 4 + col * 2, 2) !== '00') { lead = col; break; }
        }
        glyphLead.set(code, lead);
    }
    return glyphLead;
}

export function nsc_title_x(name: string): number {
    // Text containing characters above U+2000 uses the 12px unicode font in
    // MakeCode (no lead trimming for it, matching MicroOS's multiplier check).
    let charWidth = FONT8_CHAR_WIDTH;
    let lead = 0;
    let wide = false;
    for (let i = 0; i < name.length; i++) {
        if (name.charCodeAt(i) > 0x2000) { wide = true; break; }
    }
    if (wide) {
        charWidth = 12;
    } else if (name.length > 0) {
        lead = loadGlyphLead().get(name.charCodeAt(0)) || 0;
    }
    return Math.floor(charWidth * name.length / 2) + 1 - lead;
}

// MARK: Source Decoder
// Port of nanoSDK_decode: normalises package source lines into [CMD, ...args]
// entries. Invalid commands decode to NOP; `invalid` holds the index (into the
// body lines) of each one so callers can point at the source.
export interface DecodedProgram {
    program: string[][];
    invalid: number[];
}

export function decodeNanoSDK(src: string[]): DecodedProgram {
    // :BLW joins a line with the one below it (except LOP :BLW, whose
    // condition line is consumed by the LOP case below)
    const lines: string[] = [];
    const origin: number[] = []; // lines[k] came from src[origin[k]]
    let i = 0;
    while (i < src.length) {
        const l = src[i].trim();
        if (l === '') { i++; continue; }
        if (l.toUpperCase() !== 'LOP :BLW' && l.length > 4 && l.substr(l.length - 4).toUpperCase() === ':BLW') {
            const base = l.substr(0, l.length - 4).trim();
            const start = i;
            i++;
            while (i < src.length && src[i].trim() === '') { i++; }
            lines.push(i < src.length ? base + ' ' + src[i++].trim() : base);
            origin.push(start);
        } else {
            lines.push(l);
            origin.push(i);
            i++;
        }
    }

    const out: string[][] = [];
    const invalid: number[] = [];
    let lgoN = 0;
    let lgoStart = 0;
    let lgoA: string[] = [];

    const bad = (li: number) => { out.push(['NOP']); invalid.push(origin[Math.min(li, origin.length - 1)]); };

    for (let li = 0; li < lines.length; li++) {
        const l = lines[li];

        if (lgoN > 0) {
            lgoA.push(l);
            lgoN--;
            if (lgoN === 0) { out.push(['LGO'].concat(lgoA)); lgoA = []; }
            continue;
        }

        const tk = nsc_tokens(l);
        if (tk.length === 0) { continue; }
        const cmd = tk[0].toUpperCase();
        const a = tk.slice(1);
        let ok = false;

        switch (cmd) {
            case 'PRN':
            case 'END':
            case 'ASM':
                out.push([cmd, a.join(' ')]); ok = true; break;

            case 'IFB':
            case 'WHN': {
                if (a.length === 0) { break; }
                switch (a[0].toLowerCase()) {
                    case 'end': out.push([cmd, 'e']); ok = true; break;
                    case 'els': if (cmd === 'IFB') { out.push(['IFB', 'l']); ok = true; } break;
                    case 'var': if (a.length >= 3) { out.push([cmd, 'v', a[1], nsc_cmp(a[2]), a.slice(3).join(' ')]); ok = true; } break;
                    case 'btn': if (a.length >= 3) { out.push([cmd, 'b', nsc_btn(a[1]), nsc_bs(a[2])]); ok = true; } break;
                    case 'spr': if (a.length >= 3) { out.push([cmd, 's', a[1], a[2].toLowerCase() === 'tch' ? 'tch' : nsc_cmp(a[2]), a.slice(3).join(' ')]); ok = true; } break;
                    case 'sel': if (cmd === 'WHN' && a.length >= 2) { out.push(['WHN', 'sel', a[1]]); ok = true; } break;
                }
                break;
            }

            case 'LOP': {
                const p = a.length > 0 ? a[0].toLowerCase() : '';
                switch (p) {
                    case 'end': out.push(['LOP', 'e']); ok = true; break;
                    case 'ext': out.push(['LOP', 'x']); ok = true; break;
                    case 'inf': out.push(['LOP', 'inf']); ok = true; break;
                    case ':blw': {
                        // next line is the condition (IFB btn/var/spr)
                        const opLi = li;
                        li++;
                        const before = out.length;
                        if (li < lines.length) {
                            const ctk = nsc_tokens(lines[li]);
                            const cac = ctk.length > 1 ? ctk[1].toLowerCase() : '';
                            const ca = ctk.slice(2);
                            switch (cac) {
                                case 'btn': if (ca.length >= 2) { out.push(['LOP', 'BLW', 'b', nsc_btn(ca[0]), nsc_bs(ca[1])]); } break;
                                case 'var': if (ca.length >= 2) { out.push(['LOP', 'BLW', 'v', ca[0], nsc_cmp(ca[1]), ca.slice(2).join(' ')]); } break;
                                case 'spr': if (ca.length >= 2) { out.push(['LOP', 'BLW', 's', ca[0], ca[1].toLowerCase() === 'tch' ? 'tch' : nsc_cmp(ca[1]), ca.slice(2).join(' ')]); } break;
                            }
                        }
                        if (out.length === before) { bad(opLi); } // missing/invalid condition
                        ok = true; // already pushed (either the loop or the NOP)
                        break;
                    }
                    default: {
                        const n = parseInt(p, 10);
                        // not a number: invalid (error 301)
                        if (isNaN(n)) { bad(li); } else { out.push(['LOP', n.toString()]); }
                        ok = true;
                    }
                }
                break;
            }

            case 'CLG': {
                const p = a.length > 0 ? a[0].toLowerCase() : '';
                out.push(['CLG', p === 'ful' ? 'f' : p === 'scl' ? 's' : '']); ok = true; break;
            }
            case 'LGP':
            case 'LGD': if (a.length >= 2) { out.push([cmd, a[0], a[1]]); ok = true; } break;
            case 'LGO': {
                if (a.length < 1) { break; }
                const n = parseInt(a[0], 10);
                if (isNaN(n)) { break; }
                lgoN = n; lgoStart = li; lgoA = [];
                ok = true;
                break;
            }
            case 'LGS': if (a.length >= 1) { out.push(['LGS', a[0], a.slice(1).join(' ')]); ok = true; } break;
            case 'LGV': if (a.length >= 2) { out.push(['LGV', a[0], a[1]]); ok = true; } break;
            case 'LGR': if (a.length >= 1) { out.push(['LGR', a[0]]); ok = true; } break;
            case 'DLG': out.push(['DLG']); ok = true; break;
            case 'LGH': {
                if (a.length < 1) { break; }
                const m = a[0].toLowerCase();
                out.push(['LGH', m === 'off' ? 'o' : m === 'auto' ? 'a' : parseInt(m, 10).toString()]); ok = true; break;
            }
            case 'LGT': if (a.length >= 1) { out.push(['LGT', a[0].toLowerCase()]); ok = true; } break;
            case 'LSB': if (a.length >= 1) { out.push(['LSB', a[0].toLowerCase() === 'on' ? 't' : 'f']); ok = true; } break;

            case 'DVR':
            case 'SVR': if (a.length >= 2) { out.push([cmd, a[0], a[1]]); ok = true; } break;
            case 'VRM': if (a.length >= 3) { out.push(['VRM', a[0], nsc_op(a[1]), a[2]]); ok = true; } break;
            case 'VCJ': if (a.length >= 1) { out.push(['VCJ', a[0], a.slice(1).join(' ')]); ok = true; } break;
        }

        if (!ok) { bad(li); } // unknown or malformed command (MicroOS error 301)
    }
    if (lgoN > 0) { bad(lgoStart); } // LGO promised more lines than the app has

    return { program: out, invalid };
}

// MARK: Run-preview bridge
// The built-in runtime (runtime/nanosdk_runtime.js, synced from NanoSDK-Desktop)
// executes the 2026.x opcode format. A 2027.1 package differs from 2026.x
// source in only three ways: the TXP header line, LGO taking a plain count,
// and WHN sel being 0-based instead of 1-based. This turns a 2027.1 package
// back into 2026.x source so the preview can compile and run it.
// Returns null if `nsa` is not a 2027.1 package (e.g. already a 2026.x binary).
export function isPackage2027(nsa: string): boolean {
    const parts = nsa.split('~');
    if (parts.length < 4) { return false; }
    for (let i = 4; i < parts.length; i++) {
        if (parts[i].includes('§')) { return false; }
    }
    return true;
}

export function packageToLegacySource(nsa: string): string {
    const parts = nsa.split('~');
    const [name, icon, submenu, titleX] = parts;
    const out = [`DAN ${name}`, `DAI ${icon}`, `ASM ${submenu}`, `TXP ${titleX}`];
    for (const line of parts.slice(4)) {
        const t = line.trim();
        let m = /^LGO\s+(\d+)\s*$/i.exec(t);
        if (m) { out.push(`LGO str${m[1]}`); continue; }
        m = /^WHN\s+sel\s+(\d+)(.*)$/i.exec(t);
        if (m) { out.push(`WHN sel ${parseInt(m[1], 10) + 1}${m[2]}`); continue; }
        out.push(line);
    }
    return out.join('\n');
}
