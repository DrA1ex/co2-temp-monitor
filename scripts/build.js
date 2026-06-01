import * as esbuild from 'esbuild';
import {copyFile, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(rootDir, 'web');
const bundleDir = path.join(rootDir, 'bundle');

const files = {
    html: path.join(webDir, 'index.html'),
    css: path.join(webDir, 'app.css'),
    js: path.join(webDir, 'index.js'),
    manifest: path.join(webDir, 'manifest.webmanifest'),
    icon: path.join(webDir, 'icon.svg'),
    appleTouchIcon: path.join(webDir, 'apple-touch-icon.png'),
};

const output = {
    html: path.join(bundleDir, 'index.html'),
    css: path.join(bundleDir, 'app.css'),
    js: path.join(bundleDir, 'index.js'),
    manifest: path.join(bundleDir, 'manifest.webmanifest'),
    icon: path.join(bundleDir, 'icon.svg'),
    appleTouchIcon: path.join(bundleDir, 'apple-touch-icon.png'),
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

async function build() {
    await rm(bundleDir, {recursive: true, force: true});
    await mkdir(bundleDir, {recursive: true});

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

    const html = await readFile(files.html, 'utf8');
    await writeFile(output.html, await minifyHtml(html));
    await copyFile(files.manifest, output.manifest);
    await copyFile(files.icon, output.icon);
    await copyFile(files.appleTouchIcon, output.appleTouchIcon);

    console.log('Built bundle:');
    await reportFile('index.html', output.html);
    await reportFile('app.css', output.css);
    await reportFile('index.js', output.js);
    await reportFile('manifest', output.manifest);
    await reportFile('icon.svg', output.icon);
    await reportFile('apple icon', output.appleTouchIcon);
}

build().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
