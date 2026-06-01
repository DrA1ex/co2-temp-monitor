import Chart from '../node_modules/chart.js/auto';
import {bindChartFullscreen} from './chart-fullscreen.js';
import {createSensorColorResolver} from './sensor-presentation.js';

function formatDatePart(date, includeYear = false) {
    return date.toLocaleDateString([], {
        day: '2-digit',
        month: '2-digit',
        ...(includeYear ? {year: 'numeric'} : {}),
    });
}

function formatTimePart(date, includeSeconds = false) {
    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        ...(includeSeconds ? {second: '2-digit'} : {}),
    });
}

function formatChartTickLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return formatTimePart(date);

    const isCurrentYear = date.getFullYear() === now.getFullYear();
    return [
        formatDatePart(date, !isCurrentYear),
        formatTimePart(date),
    ];
}

function formatFullDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString([], {day: '2-digit', month: '2-digit', year: 'numeric'})}, ${formatTimePart(date, true)}`;
}

function transformData(apiData) {
    const timeMap = new Map();
    const prevValues = {};

    apiData.forEach(series => {
        const key = series.config.key;
        prevValues[key] = series.data[0]?.value ?? null;
        series.data.forEach(row => {
            const timestamp = Math.round(new Date(row.time).getTime() / 1000);
            if (!timeMap.has(timestamp)) {
                timeMap.set(timestamp, {time: new Date(row.time)});
            }
            timeMap.get(timestamp)[key] = row.value;
        });
    });

    const sortedData = Array.from(timeMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, value]) => value);

    sortedData.forEach(row => {
        Object.keys(prevValues).forEach(key => {
            if (row[key] !== undefined) {
                prevValues[key] = row[key];
            } else {
                row[key] = prevValues[key];
            }
        });
        row.chartTime = row.time.toISOString();
        row.time = row.time.toLocaleString();
    });

    return sortedData;
}

function isTouchViewport() {
    return window.matchMedia?.('(hover: none), (pointer: coarse)').matches;
}

function clearChartTooltip(chart) {
    chart.setActiveElements([]);
    chart.tooltip?.setActiveElements([], {x: 0, y: 0});
    chart.update('none');
}

function bindTouchTooltip(chart) {
    const {canvas} = chart;
    const previousTouchAction = canvas.style.touchAction;

    function handleTouchEnd() {
        clearChartTooltip(chart);
    }

    canvas.style.touchAction = 'none';
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    return () => {
        canvas.style.touchAction = previousTouchAction;
        canvas.removeEventListener('touchend', handleTouchEnd);
        canvas.removeEventListener('touchcancel', handleTouchEnd);
    };
}

export function createChartView({canvas, cardEl, statusEl, fullscreenBtn}) {
    let chartInstance = null;
    let touchTooltipCleanup = null;
    let lastDrawArgs = null;
    const touchModeQuery = window.matchMedia?.('(hover: none), (pointer: coarse)');

    function setState(state, message = '') {
        if (!cardEl) return;
        cardEl.classList.remove('has-data', 'is-loading', 'is-empty');

        if (state === 'data') {
            cardEl.classList.add('has-data');
            if (statusEl) statusEl.textContent = '';
            statusEl?.classList.remove('shimmer');
            return;
        }

        if (state === 'loading') {
            cardEl.classList.add('is-loading');
            if (statusEl) statusEl.textContent = message || 'Loading chart...';
            statusEl?.classList.add('shimmer');
            return;
        }

        cardEl.classList.add('is-empty');
        if (statusEl) statusEl.textContent = message || 'No data available for selected parameters.';
        statusEl?.classList.remove('shimmer');
    }

    function destroy() {
        touchTooltipCleanup?.();
        touchTooltipCleanup = null;
        if (!chartInstance) return;
        chartInstance.destroy();
        chartInstance = null;
        lastDrawArgs = null;
    }

    function redrawForInputMode() {
        if (!lastDrawArgs) return;
        draw(...lastDrawArgs);
    }

    if (touchModeQuery?.addEventListener) {
        touchModeQuery.addEventListener('change', redrawForInputMode);
    } else {
        touchModeQuery?.addListener?.(redrawForInputMode);
    }

    function resizeSoon() {
        window.setTimeout(() => chartInstance?.resize(), 60);
    }

    function draw(apiData, suggestedMin, suggestedMax) {
        lastDrawArgs = [apiData, suggestedMin, suggestedMax];
        const chartData = transformData(apiData);
        const styles = getComputedStyle(document.documentElement);
        const textColor = styles.getPropertyValue('--text').trim() || '#12202a';
        const mutedColor = styles.getPropertyValue('--muted').trim() || '#667985';
        const gridColor = 'rgba(100, 116, 139, 0.14)';
        const isNarrowViewport = window.matchMedia('(max-width: 620px)').matches;
        const shouldUseTouchTooltip = isTouchViewport();
        const chartWidth = canvas?.clientWidth || window.innerWidth;
        const xTickLimit = Math.max(3, Math.floor(chartWidth / (isNarrowViewport ? 96 : 138)));
        const getSensorColor = createSensorColorResolver(apiData);

        const datasets = apiData.map((series, index) => ({
            label: `${series.config.name}${series.config.unit ? ` (${series.config.unit})` : ''}`,
            data: chartData,
            borderColor: getSensorColor(series, index),
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointHoverBorderWidth: 2,
            tension: 0.22,
            parsing: {xAxisKey: 'chartTime', yAxisKey: series.config.key},
            yAxisID: index === 0 ? 'y' : `y${index + 1}`,
        }));

        const extraScales = {};
        apiData.slice(1).forEach((_, index) => {
            const seriesIndex = index + 1;
            const series = apiData[seriesIndex];
            const color = getSensorColor(series, seriesIndex);
            extraScales[`y${index + 2}`] = {
                type: 'linear',
                position: "right",
                grid: {drawOnChartArea: false, tickLength: 0},
                ticks: {color, display: !isNarrowViewport, padding: 10, maxTicksLimit: 6},
                border: {color, display: !isNarrowViewport},
                title: {display: false},
                suggestedMin: suggestedMin?.[index + 1], suggestedMax: suggestedMax?.[index + 1],
            };
        });

        touchTooltipCleanup?.();
        touchTooltipCleanup = null;
        chartInstance?.destroy();
        chartInstance = null;

        chartInstance = new Chart(canvas, {
            type: 'line',
            data: {datasets},
            options: {
                animation: false,
                layout: {padding: {top: 8, right: 8, bottom: 2, left: 8}},
                maintainAspectRatio: false,
                responsive: true,
                events: shouldUseTouchTooltip ? ['touchstart', 'touchmove'] : undefined,
                interaction: {mode: 'index', intersect: false},
                plugins: {
                    legend: {
                        display: false,
                        position: 'top',
                        align: 'start',
                        labels: {
                            color: textColor,
                            boxWidth: 28,
                            boxHeight: 3,
                            usePointStyle: false,
                            padding: 24
                        }
                    },
                    tooltip: {
                        mode: shouldUseTouchTooltip ? 'index' : 'nearest',
                        intersect: false,
                        backgroundColor: '#12202a',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: true,
                        callbacks: {
                            title: items => {
                                const value = items[0]?.raw?.chartTime || items[0]?.label;
                                return formatFullDateTime(value);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'category',
                        ticks: {
                            autoSkip: true,
                            maxRotation: 0,
                            minRotation: 0,
                            color: mutedColor,
                            padding: 10,
                            maxTicksLimit: xTickLimit,
                            callback(value) {
                                return formatChartTickLabel(this.getLabelForValue(value));
                            },
                        },
                        grid: {display: false, tickLength: 0},
                        border: {display: false}
                    },
                    y: {
                        position: 'left',
                        suggestedMin: suggestedMin?.[0],
                        suggestedMax: suggestedMax?.[0],
                        grid: {color: gridColor, tickLength: 0},
                        ticks: {color: getSensorColor(apiData[0], 0), padding: 10, maxTicksLimit: 6},
                        border: {color: getSensorColor(apiData[0], 0)},
                        title: {display: false}
                    },
                    ...extraScales,
                },
            },
        });
        touchTooltipCleanup = shouldUseTouchTooltip ? bindTouchTooltip(chartInstance) : null;
        chartInstance.__lastData = apiData;
    }

    const fullscreen = bindChartFullscreen({
        cardEl,
        fullscreenBtn,
        onResize: resizeSoon,
    });

    return {
        destroy,
        draw,
        exitPseudoFullscreen: fullscreen.exitPseudoFullscreen,
        setState,
    };
}
