import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {deflateSync} from 'node:zlib';

export const PWA_ASSET_DIR = 'pwa-assets';

const ICON_SIZES = [192, 512];
const APPLE_TOUCH_ICON_SIZE = 180;

const VIEWPORTS = [
    {width: 320, height: 568, ratio: 2},
    {width: 375, height: 667, ratio: 2},
    {width: 375, height: 812, ratio: 3},
    {width: 390, height: 844, ratio: 3},
    {width: 393, height: 852, ratio: 3},
    {width: 414, height: 736, ratio: 3},
    {width: 414, height: 896, ratio: 2},
    {width: 414, height: 896, ratio: 3},
    {width: 428, height: 926, ratio: 3},
    {width: 430, height: 932, ratio: 3},
    {width: 744, height: 1133, ratio: 2},
    {width: 768, height: 1024, ratio: 2},
    {width: 810, height: 1080, ratio: 2},
    {width: 820, height: 1180, ratio: 2},
    {width: 834, height: 1112, ratio: 2},
    {width: 834, height: 1194, ratio: 2},
    {width: 1024, height: 1366, ratio: 2},
];

const THEMES = {
    light: {
        background: [248, 250, 252, 255],
        text: [100, 116, 139, 255],
    },
    dark: {
        background: [21, 27, 35, 255],
        text: [148, 163, 184, 255],
    },
};

function getIconSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="logo-gradient" x1="92" y1="92" x2="420" y2="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#0ea5e9"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="104" fill="url(#logo-gradient)"/>
  <path d="M3 12h2.5l3-9 4.5 15 3-6 2.5 4H21" transform="translate(64 64) scale(16)" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

function startupImageName({width, height, ratio, orientation, theme}) {
    return `launch-${width}x${height}@${ratio}x-${orientation}-${theme}.png`;
}

function getStartupImageEntries() {
    return VIEWPORTS.flatMap(viewport => (
        ['portrait', 'landscape'].flatMap(orientation => (
            Object.keys(THEMES).map(theme => ({
                ...viewport,
                orientation,
                theme,
                fileName: startupImageName({...viewport, orientation, theme}),
            }))
        ))
    ));
}

export function getStartupImageLinks() {
    return getStartupImageEntries()
        .map(({width, height, ratio, orientation, theme, fileName}) => (
            `    <link rel="apple-touch-startup-image" href="./${PWA_ASSET_DIR}/${fileName}" media="screen and (device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation}) and (prefers-color-scheme: ${theme})"/>`
        ))
        .join('\n');
}

function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let j = 0; j < 8; j += 1) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[i] = value >>> 0;
    }
    return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const typeBuffer = Buffer.from(type);
    const length = Buffer.alloc(4);
    const crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
    return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, pixels) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;

    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        raw[y * (stride + 1)] = 0;
        pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw, {level: 9})),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function setPixel(pixels, width, x, y, color, alpha = 1) {
    const index = ((Math.round(y) * width) + Math.round(x)) * 4;
    if (index < 0 || index + 3 >= pixels.length) return;

    const a = Math.max(0, Math.min(1, alpha));
    const inverse = 1 - a;
    pixels[index] = Math.round((color[0] * a) + (pixels[index] * inverse));
    pixels[index + 1] = Math.round((color[1] * a) + (pixels[index + 1] * inverse));
    pixels[index + 2] = Math.round((color[2] * a) + (pixels[index + 2] * inverse));
    pixels[index + 3] = 255;
}

function fillBackground(pixels, color) {
    for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = color[0];
        pixels[i + 1] = color[1];
        pixels[i + 2] = color[2];
        pixels[i + 3] = color[3];
    }
}

function fillGradientBackground(pixels, width, height) {
    const start = [37, 99, 235, 255];
    const end = [14, 165, 233, 255];

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const ratio = (x + y) / (width + height);
            setPixel(pixels, width, x, y, [
                Math.round(start[0] * (1 - ratio) + end[0] * ratio),
                Math.round(start[1] * (1 - ratio) + end[1] * ratio),
                Math.round(start[2] * (1 - ratio) + end[2] * ratio),
                255,
            ]);
        }
    }
}

function inRoundedRect(x, y, left, top, size, radius) {
    const right = left + size;
    const bottom = top + size;
    const nearestX = Math.max(left + radius, Math.min(x, right - radius));
    const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
    const insideCore = x >= left + radius && x <= right - radius && y >= top && y <= bottom;
    const insideSides = y >= top + radius && y <= bottom - radius && x >= left && x <= right;
    const dx = x - nearestX;
    const dy = y - nearestY;
    return insideCore || insideSides || ((dx * dx) + (dy * dy) <= radius * radius);
}

function drawLogoTile(pixels, width, height, theme) {
    const tileSize = Math.round(Math.min(width, height) * 0.17);
    const radius = Math.round(tileSize * 0.23);
    const left = Math.round((width - tileSize) / 2);
    const top = Math.round((height - tileSize) / 2 - Math.min(width, height) * 0.035);

    drawGradientRoundSquare(pixels, width, left, top, tileSize, radius);
    drawWaveform(pixels, width, left, top, tileSize, Math.max(5, tileSize * 0.065));

    const label = theme === 'dark' ? THEMES.dark.text : THEMES.light.text;
    drawTextBars(pixels, width, height, label, top + tileSize + Math.round(tileSize * 0.24));
}

function drawGradientRoundSquare(pixels, width, left, top, size, radius) {
    const start = [37, 99, 235];
    const end = [14, 165, 233];

    for (let y = top; y < top + size; y += 1) {
        for (let x = left; x < left + size; x += 1) {
            if (!inRoundedRect(x + 0.5, y + 0.5, left, top, size, radius)) continue;

            const ratio = ((x - left) + (y - top)) / (size * 2);
            setPixel(pixels, width, x, y, [
                Math.round(start[0] * (1 - ratio) + end[0] * ratio),
                Math.round(start[1] * (1 - ratio) + end[1] * ratio),
                Math.round(start[2] * (1 - ratio) + end[2] * ratio),
                255,
            ]);
        }
    }
}

function drawWaveform(pixels, width, left, top, size, thickness) {
    drawPolyline(pixels, width, [
        [3, 12],
        [5.5, 12],
        [8.5, 3],
        [13, 18],
        [16, 12],
        [18.5, 16],
        [21, 16],
    ].map(([x, y]) => [
        left + (x / 24) * size,
        top + (y / 24) * size,
    ]), thickness, [255, 255, 255, 255]);
}

function drawTextBars(pixels, width, height, color, top) {
    const lineHeight = Math.max(5, Math.round(Math.min(width, height) * 0.008));
    const firstWidth = Math.round(width * 0.28);
    const secondWidth = Math.round(width * 0.18);
    const left = Math.round((width - firstWidth) / 2);

    fillRoundedBar(pixels, width, left, top, firstWidth, lineHeight, lineHeight / 2, color, 0.55);
    fillRoundedBar(pixels, width, Math.round((width - secondWidth) / 2), top + lineHeight * 3, secondWidth, lineHeight, lineHeight / 2, color, 0.28);
}

function fillRoundedBar(pixels, width, left, top, barWidth, barHeight, radius, color, alpha) {
    for (let y = Math.round(top); y < top + barHeight; y += 1) {
        for (let x = left; x < left + barWidth; x += 1) {
            const nearestX = Math.max(left + radius, Math.min(x, left + barWidth - radius));
            const nearestY = Math.max(top + radius, Math.min(y, top + barHeight - radius));
            const dx = x - nearestX;
            const dy = y - nearestY;
            if ((dx * dx) + (dy * dy) <= radius * radius || (x >= left + radius && x <= left + barWidth - radius)) {
                setPixel(pixels, width, x, y, color, alpha);
            }
        }
    }
}

function drawPolyline(pixels, width, points, thickness, color) {
    for (let i = 1; i < points.length; i += 1) {
        drawLine(pixels, width, points[i - 1], points[i], thickness, color);
    }
}

function drawLine(pixels, width, from, to, thickness, color) {
    const minX = Math.floor(Math.min(from[0], to[0]) - thickness);
    const maxX = Math.ceil(Math.max(from[0], to[0]) + thickness);
    const minY = Math.floor(Math.min(from[1], to[1]) - thickness);
    const maxY = Math.ceil(Math.max(from[1], to[1]) + thickness);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const lengthSquared = (dx * dx) + (dy * dy);
    const radius = thickness / 2;

    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const t = Math.max(0, Math.min(1, (((x - from[0]) * dx) + ((y - from[1]) * dy)) / lengthSquared));
            const px = from[0] + dx * t;
            const py = from[1] + dy * t;
            const distance = Math.hypot(x - px, y - py);
            if (distance <= radius + 1) {
                setPixel(pixels, width, x, y, color, Math.min(1, radius + 1 - distance));
            }
        }
    }
}

function renderIcon(size) {
    const pixels = Buffer.alloc(size * size * 4);
    fillGradientBackground(pixels, size, size);
    drawWaveform(pixels, size, size * 0.125, size * 0.125, size * 0.75, Math.max(8, size * 0.035));
    return encodePng(size, size, pixels);
}

function renderStartupImage({width, height, ratio, orientation, theme}) {
    const pixelWidth = width * ratio;
    const pixelHeight = height * ratio;
    const imageWidth = orientation === 'portrait' ? pixelWidth : pixelHeight;
    const imageHeight = orientation === 'portrait' ? pixelHeight : pixelWidth;
    const pixels = Buffer.alloc(imageWidth * imageHeight * 4);

    fillBackground(pixels, THEMES[theme].background);
    drawLogoTile(pixels, imageWidth, imageHeight, theme);

    return encodePng(imageWidth, imageHeight, pixels);
}

export async function generatePwaAssets(outputDir) {
    const targetDir = path.join(outputDir, PWA_ASSET_DIR);
    await mkdir(targetDir, {recursive: true});

    await writeFile(path.join(targetDir, 'icon.svg'), getIconSvg());
    await writeFile(path.join(targetDir, 'apple-touch-icon.png'), renderIcon(APPLE_TOUCH_ICON_SIZE));

    await Promise.all(ICON_SIZES.flatMap(size => [
        writeFile(path.join(targetDir, `icon-${size}.png`), renderIcon(size)),
        writeFile(path.join(targetDir, `maskable-${size}.png`), renderIcon(size)),
    ]));

    await Promise.all(getStartupImageEntries().map(async entry => {
        await writeFile(path.join(targetDir, entry.fileName), renderStartupImage(entry));
    }));
}
