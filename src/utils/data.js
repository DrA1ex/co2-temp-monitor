export function shrinkData(data, maxLength, ratio, distributionFn, valueFn) {
    if (data.length === 0) return [];

    const shrunk = [];
    let i = 0, prevIndex;

    for (let index of distributionFn(0, data.length - 1, maxLength, ratio)) {
        index = Math.round(index);
        if (prevIndex === undefined) prevIndex = index;

        shrunk[i++] = {
            value: aggregateAverage(data, prevIndex, index, valueFn),
            time: data[index].time
        };

        prevIndex = index + 1;
    }

    return shrunk;
}


export function* logDistribution(min, max, count, ratio = 1) {
    if (count < 2) throw new Error("Count should be greater or equals 2");
    if (min > max) [min, max] = [max, min];

    let offset = 0;
    if (min < 1) {
        offset = Math.abs(min) + 1;
        min += offset;
        max += offset;
    }

    ratio = Math.max(0, Math.min(1, ratio));
    for (let i = 0; i < count; i++) {
        // Linear distribution value between 0 and 1
        const linearValue = i / (count - 1);

        const logarithmicValue = i > 0 ? Math.log10(1 + linearValue * 9) : 0;

        const interpolatedValue = (1 - ratio) * linearValue + ratio * logarithmicValue;
        const scaledValue = min + interpolatedValue * (max - min);

        yield scaledValue - offset;
    }
}

export function* invertedLogDistribution(min, max, count, ratio = 1) {
    const values = Array.from(logDistribution(min, max, count, ratio)).reverse();

    let prev = values[0];
    let last = min;
    for (const value of values) {
        const delta = (prev - value);
        yield last + delta;

        prev = value;
        last += delta;
    }
}

function aggregateAverage(data, from, to, fn) {
    if (from >= to) return fn(data[to]);

    let value = 0;
    for (let i = from; i <= to; i++) {
        value += fn(data[i]);
    }

    const length = to - from + 1;
    return value / length;
}