import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { compileNanoSDK, parseIconFileContent, resolveLocalIconSync } from '../compiler/compiler';
import { decompileNSA } from '../compiler/decompiler';
import { packageNanoSDK, nsc_title_x, isPackage2027, packageToLegacySource } from '../compiler/packager';

async function runAllTests() {
    console.log('🧪 Running NanoSDK Extension Automated Tests...\n');
    let passed = 0;
    let failed = 0;

    function test(name: string, fn: () => void | Promise<void>) {
        try {
            const res = fn();
            if (res instanceof Promise) {
                return res.then(() => {
                    console.log(`  ✅ PASS: ${name}`);
                    passed++;
                }).catch((err) => {
                    console.error(`  ❌ FAIL: ${name}`);
                    console.error(err);
                    failed++;
                });
            } else {
                console.log(`  ✅ PASS: ${name}`);
                passed++;
            }
        } catch (err) {
            console.error(`  ❌ FAIL: ${name}`);
            console.error(err);
            failed++;
        }
    }

    // Test 1: Standard Counter Application Compilation
    await test('Compile Counter App to NSA', async () => {
        const source = `DAN Counter
DAI default
ASM main
TXP 020
DVR count 0
CLG ful
LGH auto
LGO str3
Count: !count!
Add
Reset
WHN sel 002
VRM count add 1
LGS 000 Count: !count!
WHN end
WHN sel 003
SVR count 0
LGS 000 Count: 0
WHN end
LOP inf
LOP end`;

        const res = await compileNanoSDK(source);
        assert.strictEqual(res.success, true, 'Compilation should succeed');
        assert.ok(res.nsaContent, 'NSA content should be present');

        const parts = res.nsaContent!.split('~');
        assert.strictEqual(parts[0], 'Counter', 'App name must be Counter');
        assert.strictEqual(parts[1], 'default', 'Icon must be default');
        assert.strictEqual(parts[2], 'main', 'Submenu must be main');
        assert.strictEqual(parts[3], '020', 'TXP must be 020');
        assert.ok(parts.includes('501§count§000'), 'Should contain DVR count');
        assert.ok(parts.includes('301§f'), 'Should contain CLG ful (301§f)');
        assert.ok(parts.includes('309§a'), 'Should contain LGH auto (309§a)');
        assert.ok(parts.includes('304§Count: !count!§Add§Reset'), 'Should contain LGO str3 (304§...)');
        assert.ok(parts.includes('401§sel§002'), 'Should contain WHN sel 002');
        assert.ok(parts.includes('503§count§a§001'), 'Should contain VRM count add 001');
        assert.ok(parts.includes('305§000§Count: !count!'), 'Should contain LGS 000 Count: !count!');
        assert.ok(parts.includes('202§inf'), 'Should contain LOP inf');
        assert.ok(parts.includes('202§e'), 'Should contain LOP end');
    });

    // Test 2: Icon Parsing and DAI Inlining (.mpi / .wrt)
    await test('Parse .mpi icon and inline into NSA header', async () => {
        const mpiContent = `0AAAABB0
AA1AB1B3
AA11B133
AA11B133
AB1B1132
BB131122
BB133122
03332220`;

        const hex = parseIconFileContent(mpiContent);
        assert.strictEqual(hex.length, 64, 'Hex string must be 64 characters');
        assert.strictEqual(hex, '0AAAABB0AA1AB1B3AA11B133AA11B133AB1B1132BB131122BB13312203332220');

        const tempDir = path.join(__dirname, '../../test-temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const iconFile = path.join(tempDir, 'myicon.mpi');
        const projectFile = path.join(tempDir, 'app.nsp');

        fs.writeFileSync(iconFile, mpiContent, 'utf8');

        const source = `DAN TestApp
DAI myicon.mpi
ASM main
TXP 015
PRN Hello`;

        const res = await compileNanoSDK(source, { sourceFilePath: projectFile });
        assert.strictEqual(res.success, true);
        const parts = res.nsaContent!.split('~');
        assert.strictEqual(parts[1], hex, 'Compiled NSA header must contain the inlined 64-char icon hex');

        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // Test 3: :BLW and LOP :BLW
    await test('Handle :BLW line continuation and LOP :BLW conditional loop', async () => {
        const source = `DAN LongLineApp
DAI default
ASM main
TXP 000
PRN This is a very long line :BLW
that was continued on the second line
LOP :BLW
IFB btn btna dwn
  PRN Button A is down
LOP end`;

        const res = await compileNanoSDK(source);
        assert.strictEqual(res.success, true);
        const parts = res.nsaContent!.split('~');
        assert.ok(parts.includes('105§This is a very long line that was continued on the second line'));
        assert.ok(parts.includes('202§BLW§b§a§t'), 'LOP :BLW should encode conditional loop 202§BLW§b§a§t');
    });

    // Test 4: Decompiler Roundtrip
    await test('Decompile NSA Binary back to readable instructions', () => {
        const nsa = 'MyGame~default~main~020~301§f~304§Play§Exit~401§sel§001~105§Game Started!~401§e~202§inf~202§e';
        const disassembled = decompileNSA(nsa);

        assert.strictEqual(disassembled.appName, 'MyGame');
        assert.strictEqual(disassembled.submenu, 'main');
        assert.strictEqual(disassembled.txp, '020');
        assert.strictEqual(disassembled.instructions.length, 7);
        assert.strictEqual(disassembled.instructions[0].instruction, 'CLG ful');
        assert.strictEqual(disassembled.instructions[2].instruction, 'WHN sel 001');
        assert.strictEqual(disassembled.instructions[3].instruction, 'PRN Game Started!');
    });

    // Test 5: Missing header error detection
    await test('Detect missing headers', async () => {
        const invalidSource = `PRN Only one line`;
        const res = await compileNanoSDK(invalidSource);
        assert.strictEqual(res.success, false);
        assert.ok(res.errors.length > 0);
    });
    // MARK: 2027.1 packager
    await test('2027.1 package: plain source, 3-line header, auto title X', async () => {
        const source = `DAN Counter
DAI default
ASM main

// comment line
DVR count 0
CLG ful
LGO 3
Count: !count!
Add
Reset
WHN sel 1
  VRM count add 1
WHN end
LOP inf
LOP end`;
        const res = await packageNanoSDK(source);
        assert.strictEqual(res.success, true, res.errors.join('; '));
        const parts = res.nsaContent!.split('~');
        assert.deepStrictEqual(parts.slice(0, 3), ['Counter', 'default', 'main']);
        assert.strictEqual(parts[3], '21'); // floor(6*7/2)+1 - 1 blank leading column of "C"
        assert.strictEqual(parts[4], 'DVR count 0');
        assert.ok(!res.nsaContent!.includes('§'), 'package must be plain source');
        assert.ok(!res.nsaContent!.includes('comment'), 'comments are stripped');
        assert.ok(!res.nsaContent!.includes('  VRM'), 'indentation is stripped');
    });

    await test('2027.1 package: legacy TXP line is ignored with a warning', async () => {
        const res = await packageNanoSDK('DAN A\nDAI default\nASM main\nTXP 020\nPRN hi');
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.nsaContent!.split('~')[4], 'PRN hi');
        assert.ok(res.warnings.some(w => w.includes('TXP')));
    });

    await test('2027.1 package: non-numeric LOP count is rejected (no infinite loop)', async () => {
        const res = await packageNanoSDK('DAN A\nDAI default\nASM main\nLOP abc\nLOP end');
        assert.strictEqual(res.success, false);
        assert.ok(res.errors.some(e => e.includes('Line 4')), res.errors.join('; '));
    });

    await test('2027.1 package: old LGO strN and short LGO are rejected', async () => {
        const old = await packageNanoSDK('DAN A\nDAI default\nASM main\nLGO str2\na\nb');
        assert.strictEqual(old.success, false);
        const short = await packageNanoSDK('DAN A\nDAI default\nASM main\nLGO 3\na');
        assert.strictEqual(short.success, false);
    });

    await test('2027.1 package: invalid LOP :BLW condition is rejected', async () => {
        const res = await packageNanoSDK('DAN A\nDAI default\nASM main\nLOP :BLW\nIFB nope\nLOP end');
        assert.strictEqual(res.success, false);
    });

    await test('2027.1 package: missing header fails', async () => {
        const res = await packageNanoSDK('DAN A\nDAI default');
        assert.strictEqual(res.success, false);
    });

    await test('title X matches MicroOS formula', () => {
        assert.strictEqual(nsc_title_x('I'), 3 + 1 - 1); // 6*1/2 + 1 - 1 blank leading column
        assert.strictEqual(nsc_title_x(''), 1);
    });

    await test('2027.1 package round-trips to a runnable 2026.x binary (preview bridge)', async () => {
        const pkg = await packageNanoSDK('DAN Counter\nDAI default\nASM main\nDVR count 0\nCLG ful\nLGO 3\nCount: !count!\nAdd\nReset\nWHN sel 1\n VRM count add 1\nWHN end\nWHN sel 2\n SVR count 0\nWHN end\nLOP inf\nLOP end');
        assert.strictEqual(pkg.success, true, pkg.errors.join('; '));
        assert.strictEqual(isPackage2027(pkg.nsaContent!), true);
        const legacySrc = packageToLegacySource(pkg.nsaContent!);
        assert.ok(legacySrc.includes('TXP 21'), 'TXP restored from the package title X');
        assert.ok(legacySrc.includes('LGO str3'), 'LGO gets its str prefix back');
        assert.ok(legacySrc.includes('WHN sel 2') && legacySrc.includes('WHN sel 3'), 'WHN sel becomes 1-based');
        const bin = await compileNanoSDK(legacySrc);
        assert.strictEqual(bin.success, true, bin.errors.join('; '));
        assert.strictEqual(isPackage2027(bin.nsaContent!), false, 'a 2026.x binary is not mistaken for a package');
        assert.ok(bin.nsaContent!.includes('401§sel§002'));
    });


    console.log(`\n========================================`);
    console.log(`Total Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`========================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runAllTests().catch(err => {
    console.error(err);
    process.exit(1);
});
