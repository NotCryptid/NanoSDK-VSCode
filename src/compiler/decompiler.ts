/**
 * NanoSDK Decompiler / Disassembler
 * Converts compiled .nsa bytecode into human-readable instructions.
 */

export interface DisassembledApp {
    appName: string;
    iconHex: string;
    submenu: string;
    txp: string;
    instructions: DisassembledInstruction[];
}

export interface DisassembledInstruction {
    opcode: string;
    raw: string;
    instruction: string;
    description: string;
}

export function decompileNSA(nsaContent: string): DisassembledApp {
    const parts = nsaContent.split('~');
    const appName = parts[0] || 'Unknown';
    const iconHex = parts[1] || 'default';
    const submenu = parts[2] || 'main';
    const txp = parts[3] || '000';

    const rawInstructions = parts.slice(4);
    const instructions: DisassembledInstruction[] = [];

    for (const raw of rawInstructions) {
        const segs = raw.split('§');
        const op = segs[0];
        const args = segs.slice(1);

        let decoded = decodeOpcode(op, args);
        instructions.push({
            opcode: op,
            raw,
            instruction: decoded.text,
            description: decoded.description
        });
    }

    return {
        appName,
        iconHex,
        submenu,
        txp,
        instructions
    };
}

function decodeOpcode(op: string, args: string[]): { text: string; description: string } {
    switch (op) {
        case '105':
            return { text: `PRN ${args.join(' ')}`, description: `Print popup message '${args.join(' ')}'` };
        case '106':
            return { text: `END ${args.join(' ')}`, description: `End application execution` };
        case '107':
            return { text: `ASM ${args.join(' ')}`, description: `Switch submenu to '${args.join(' ')}'` };
        case '201': {
            if (args[0] === 'e') return { text: 'IFB end', description: 'End of IF condition block' };
            if (args[0] === 'l') return { text: 'IFB els', description: 'Else branch of IF condition block' };
            if (args[0] === 'v') return { text: `IFB var ${args[1]} ${decodeCmp(args[2])} ${args.slice(3).join(' ')}`, description: `If variable ${args[1]} ${decodeCmp(args[2])} ${args.slice(3).join(' ')}` };
            if (args[0] === 'b') return { text: `IFB btn ${decodeBtn(args[1])} ${decodeBs(args[2])}`, description: `If button ${decodeBtn(args[1])} is ${decodeBs(args[2])}` };
            if (args[0] === 's') return { text: `IFB spr ${args[1]} ${decodeCmp(args[2])} ${args.slice(3).join(' ')}`, description: `If sprite property ${args[1]} ${decodeCmp(args[2])} ${args.slice(3).join(' ')}` };
            return { text: `IFB ${args.join(' ')}`, description: 'If condition' };
        }
        case '401': {
            if (args[0] === 'e') return { text: 'WHN end', description: 'End of WHN event block' };
            if (args[0] === 'sel') return { text: `WHN sel ${args[1]}`, description: `When ListGUI item ${args[1]} is selected` };
            if (args[0] === 'v') return { text: `WHN var ${args[1]} ${decodeCmp(args[2])} ${args.slice(3).join(' ')}`, description: `When variable ${args[1]} ${decodeCmp(args[2])} ${args.slice(3).join(' ')}` };
            if (args[0] === 'b') return { text: `WHN btn ${decodeBtn(args[1])} ${decodeBs(args[2])}`, description: `When button ${decodeBtn(args[1])} is ${decodeBs(args[2])}` };
            if (args[0] === 's') return { text: `WHN spr ${args[1]} ${decodeCmp(args[2])} ${args.slice(3).join(' ')}`, description: `When sprite property ${args[1]} ${decodeCmp(args[2])} ${args.slice(3).join(' ')}` };
            return { text: `WHN ${args.join(' ')}`, description: 'When event' };
        }
        case '202': {
            if (args[0] === 'e') return { text: 'LOP end', description: 'End of loop block' };
            if (args[0] === 'x') return { text: 'LOP ext', description: 'Exit current loop' };
            if (args[0] === 'inf') return { text: 'LOP inf', description: 'Infinite loop' };
            if (args[0] === 'BLW') return { text: `LOP :BLW (Condition: ${args.slice(1).join('§')})`, description: 'Conditional loop' };
            return { text: `LOP ${args[0]}`, description: `Loop ${args[0]} times` };
        }
        case '301': {
            if (args[0] === 'f') return { text: 'CLG ful', description: 'Create fullscreen ListGUI' };
            if (args[0] === 's') return { text: 'CLG scl', description: 'Create scrollable ListGUI' };
            return { text: 'CLG', description: 'Create default ListGUI' };
        }
        case '302':
            return { text: `LGP ${args[0]} ${args[1]}`, description: `Set ListGUI center position to (${args[0]}, ${args[1]})` };
        case '303':
            return { text: `LGD ${args[0]} ${args[1]}`, description: `Set ListGUI dimensions to ${args[0]}x${args[1]}` };
        case '304':
            return { text: `LGO str${args.length}\n  ${args.join('\n  ')}`, description: `Define ${args.length} ListGUI menu options` };
        case '305':
            return { text: `LGS ${args[0]} ${args.slice(1).join(' ')}`, description: `Set ListGUI item at index ${args[0]} to '${args.slice(1).join(' ')}'` };
        case '306':
            return { text: `LGV ${args[0]} ${args[1]}`, description: `Get ListGUI item at index ${args[0]} into variable ${args[1]}` };
        case '307':
            return { text: `LGR ${args[0]}`, description: `Remove ListGUI item at index ${args[0]}` };
        case '308':
            return { text: 'DLG', description: 'Destroy active ListGUI' };
        case '309': {
            if (args[0] === 'o') return { text: 'LGH off', description: 'Disable ListGUI hover highlight' };
            if (args[0] === 'a') return { text: 'LGH auto', description: 'Auto ListGUI hover highlight' };
            return { text: `LGH ${args[0]}`, description: `ListGUI highlight item ${args[0]}` };
        }
        case '310':
            return { text: `LGT ${args[0]}`, description: `Set ListGUI theme to '${args[0]}'` };
        case '311':
            return { text: `LSB ${args[0] === 't' ? 'on' : 'off'}`, description: `Toggle scrollbar ${args[0] === 't' ? 'on' : 'off'}` };
        case '501':
            return { text: `DVR ${args[0]} ${args[1]}`, description: `Define variable '${args[0]}' with initial value '${args[1]}'` };
        case '502':
            return { text: `SVR ${args[0]} ${args[1]}`, description: `Set variable '${args[0]}' to value '${args[1]}'` };
        case '503': {
            const vrmOp = ({ a: 'add', s: 'sub', m: 'mul', d: 'div' } as Record<string, string>)[args[1]] || args[1];
            return { text: `VRM ${args[0]} ${vrmOp} ${args[2]}`, description: `Variable math: '${args[0]}' = '${args[0]}' ${vrmOp} '${args[2]}'` };
        }
        case '504':
            return { text: `VCJ ${args[0]} ${args.slice(1).join(' ')}`, description: `Append '${args.slice(1).join(' ')}' to variable '${args[0]}'` };
        case '000':
            return { text: 'NOP (000)', description: 'No-operation / unrecognized instruction' };
        default:
            return { text: `UNKNOWN (${op}) ${args.join(' ')}`, description: `Unknown bytecode opcode` };
    }
}

function decodeCmp(c: string): string {
    switch (c) {
        case '=': return 'eql';
        case '>': return 'mor';
        case '<': return 'les';
        case '≥': return 'moe';
        case '≤': return 'loe';
        default: return c;
    }
}

function decodeBtn(b: string): string {
    switch (b) {
        case 'a': return 'btna';
        case 'b': return 'btnb';
        case 'u': return 'dpdu';
        case 'd': return 'dpdd';
        case 'l': return 'dpdl';
        case 'r': return 'dpdr';
        default: return b;
    }
}

function decodeBs(bs: string): string {
    switch (bs) {
        case 't': return 'dwn';
        case 'f': return 'ndn';
        default: return bs;
    }
}
