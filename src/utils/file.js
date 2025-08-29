import fs from "node:fs/promises";

const FileReadTimers = {};

export async function readLastLines(fileName, linesLimit, blockSize = 32 * 1024) {
    const stats = await fs.stat(fileName);

    const blockBuffer = Buffer.alloc(blockSize);

    const file = await fs.open(fileName);
    const result = [];

    const NEW_LINE = "\n".charCodeAt(0);

    try {
        let read = 0;
        let linesRead = 0;
        let stringTail = null;
        while (read < stats.size && linesRead < linesLimit) {
            const filePos = stats.size - read - 1 - blockSize;
            const block = await file.read(blockBuffer, 0, blockSize, Math.max(0, filePos));
            read += block.bytesRead;

            let i, lastIndex = block.bytesRead;
            for (i = block.bytesRead - 1; i >= 0 && linesRead < linesLimit; i--) {
                if (blockBuffer[i] === NEW_LINE) {
                    if (lastIndex - i <= 1) {
                        lastIndex = i;
                        continue;
                    }

                    const line = blockBuffer.toString("utf-8", i + 1, lastIndex);

                    if (stringTail === null) {
                        result.push(line);
                    } else {
                        result.push(line + stringTail);
                        stringTail = null;
                    }

                    lastIndex = i;
                    linesRead++
                }
            }

            if (linesRead < linesLimit && lastIndex > 0) {
                const newTail = blockBuffer.toString("utf-8", 0, lastIndex);
                stringTail = stringTail === null ? newTail : newTail + stringTail;
            }
        }
    } finally {
        await file.close();
    }

    return result.reverse();
}

export async function watch(path, interval, callback) {
    let fsWait = false;
    for await (const {filename} of fs.watch(path)) {
        if (!filename || fsWait) continue;

        fsWait = setTimeout(() => {
            fsWait = false;
        }, interval);

        await callback(filename);
    }
}

export async function readFileText(path, interval = 5000) {
    if (FileReadTimers[path]) {
        return await FileReadTimers[path].promise;
    }

    FileReadTimers[path] = {
        timerId: setTimeout(() => FileReadTimers[path] = null, interval),
        promise: fs.readFile(path).then(f => f.toString())
    };

    return FileReadTimers[path].promise;
}

export async function listFiles(dir) {
    try {
        const entries = await fs.readdir(dir, {withFileTypes: true});
        return entries
            .filter(e => e.isFile())
            .map(e => e.name);
    } catch (err) {
        if (err.code === "ENOENT") return []; // directory not found -> empty
        throw err;
    }
}

export async function fileExists(path) {
    try {
        await fs.access(path);
        return true
    } catch {
        return false;
    }
}
