import * as esbuild from 'esbuild';
import {copyFile, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {generatePwaAssets, getStartupImageLinks} from './pwa-assets.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(rootDir, 'web');
const bundleDir = path.join(rootDir, 'bundle');

const files = {
    html: path.join(webDir, 'index.html'),
    css: path.join(webDir, 'app.css'),
    js: path.join(webDir, 'index.js'),
    manifest: path.join(webDir, 'manifest.webmanifest'),
};

const output = {
    html: path.join(bundleDir, 'index.html'),
    css: path.join(bundleDir, 'app.css'),
    js: path.join(bundleDir, 'index.js'),
    manifest: path.join(bundleDir, 'manifest.webmanifest'),
};

async function minifyInlineScript(block) {
    const match = block.match(/^<script\b([^>]*)>([\s\S]*?)<\/script>$/i);
    if (!match || /\bsrc\s*=/i.test(match[1])) return block.trim();

    const result = await esbuild.transform(match[2], {
        loader: 'js',
        minify: true,
        legalComments: 'none',
    });

    return `<script${match[1]}>${result.code.trim()}</script>`;
}

async function minifyHtml(html) {
    const preservedBlocks = [];
    const preserve = (match) => {
        const token = `__HTML_PRESERVE_${preservedBlocks.length}__`;
        preservedBlocks.push(match.trim());
        return token;
    };

    let result = html
        .replace(/<(script|style|pre|textarea)\b[\s\S]*?<\/\1>/gi, preserve)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/>\s+</g, '><')
        .trim();

    const minifiedBlocks = await Promise.all(preservedBlocks.map((block) => (
        /^<script\b/i.test(block) ? minifyInlineScript(block) : block
    )));

    minifiedBlocks.forEach((block, index) => {
        result = result.replace(`__HTML_PRESERVE_${index}__`, block);
    });

    return `${result}\n`;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

async function reportFile(label, filePath) {
    const {size} = await stat(filePath);
    console.log(`${label.padEnd(10)} ${formatBytes(size)}`);
}

async function hashFiles(filePaths) {
    const hash = createHash('sha256');
    for (const filePath of filePaths) {
        hash.update(await readFile(filePath));
    }
    return hash.digest('hex').slice(0, 10);
}

function formatBuildDate(date) {
    const pad = value => String(value).padStart(2, '0');

    return [
        `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
        `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
        'UTC',
    ].join(' ');
}

async function build() {
    await rm(bundleDir, {recursive: true, force: true});
    await mkdir(bundleDir, {recursive: true});
    await generatePwaAssets(bundleDir);

    await esbuild.build({
        entryPoints: [files.js],
        outfile: output.js,
        bundle: true,
        format: 'esm',
        minify: true,
        legalComments: 'none',
        logLevel: 'silent',
    });

    const css = await readFile(files.css, 'utf8');
    const minifiedCss = await esbuild.transform(css, {
        loader: 'css',
        minify: true,
        legalComments: 'none',
    });
    await writeFile(output.css, minifiedCss.code);
    await copyFile(files.manifest, output.manifest);

    const buildHash = await hashFiles([output.js, output.css, output.manifest]);
    const buildInfo = `Build ${formatBuildDate(new Date())} · ${buildHash}`;

    const sourceHtml = await readFile(files.html, 'utf8');
    if (!sourceHtml.includes('__BUILD_INFO__')) {
        throw new Error('Build info placeholder is missing from source HTML');
    }

    const html = sourceHtml
        .replace('    <!-- IOS_STARTUP_IMAGES -->', getStartupImageLinks())
        .replace('__BUILD_INFO__', buildInfo);
    if (html.includes('__BUILD_INFO__')) {
        throw new Error('Build info placeholder was not replaced');
    }
    await writeFile(output.html, await minifyHtml(html));

    console.log('Built bundle:');
    await reportFile('index.html', output.html);
    await reportFile('app.css', output.css);
    await reportFile('index.js', output.js);
    await reportFile('manifest', output.manifest);
}

build().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
