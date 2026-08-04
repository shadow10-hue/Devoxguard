<script setup lang="ts">
import { computed, ref } from 'vue';

interface TrendPoint {
  timestamp: number;
  score: number;
}

const props = withDefaults(
  defineProps<{
    data: TrendPoint[];
    height?: number;
  }>(),
  { height: 180 },
);

// composite-scorer.ts: score is bounded [0,1], blockThreshold is 0.7 on that
// same scale — a fixed y-domain keeps the chart comparable across renders
// rather than auto-fitting to whatever's currently in the trend buffer.
const BLOCK_THRESHOLD = 0.7;
const VIEW_WIDTH = 640;
const PAD = { top: 16, right: 12, bottom: 24, left: 32 };

const innerWidth = computed(() => VIEW_WIDTH - PAD.left - PAD.right);
const innerHeight = computed(() => props.height - PAD.top - PAD.bottom);

const timeRange = computed(() => {
  const timestamps = props.data.map((d) => d.timestamp);
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  return { min, max, span: max - min || 1 };
});

function xFor(timestamp: number): number {
  const { min, span } = timeRange.value;
  return PAD.left + ((timestamp - min) / span) * innerWidth.value;
}

function yFor(score: number): number {
  return PAD.top + (1 - Math.min(Math.max(score, 0), 1)) * innerHeight.value;
}

const points = computed(() => props.data.map((d) => ({ ...d, x: xFor(d.timestamp), y: yFor(d.score) })));

const linePath = computed(() =>
  points.value.length < 2 ? '' : points.value.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' '),
);

const areaPath = computed(() => {
  if (points.value.length < 2) return '';
  const baseline = PAD.top + innerHeight.value;
  const first = points.value[0];
  const last = points.value[points.value.length - 1];
  return `M${first.x},${baseline} ${linePath.value.slice(1)} L${last.x},${baseline} Z`;
});

const thresholdY = computed(() => yFor(BLOCK_THRESHOLD));
const gridTicks = [0, 0.5, 1];

const lastPoint = computed(() => points.value[points.value.length - 1] ?? null);

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

// Hover crosshair + tooltip, snapped to the nearest data point.
const svgEl = ref<SVGSVGElement | null>(null);
const hoverIndex = ref<number | null>(null);
const hoverPoint = computed(() => (hoverIndex.value === null ? null : points.value[hoverIndex.value]));

function onPointerMove(event: PointerEvent) {
  if (!svgEl.value || points.value.length === 0) return;
  const rect = svgEl.value.getBoundingClientRect();
  const svgX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;

  let nearest = 0;
  let nearestDist = Infinity;
  points.value.forEach((p, i) => {
    const dist = Math.abs(p.x - svgX);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = i;
    }
  });
  hoverIndex.value = nearest;
}

function onPointerLeave() {
  hoverIndex.value = null;
}

const ariaLabel = computed(() => {
  if (points.value.length === 0) return 'Anomaly score trend: no data';
  const last = points.value[points.value.length - 1];
  return `Anomaly score trend, ${points.value.length} samples, most recent score ${last.score.toFixed(2)}`;
});
</script>

<template>
  <div class="anomaly-chart">
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${VIEW_WIDTH} ${height}`"
      role="img"
      :aria-label="ariaLabel"
      preserveAspectRatio="none"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    >
      <!-- gridlines -->
      <line
        v-for="tick in gridTicks"
        :key="tick"
        class="gridline"
        :x1="PAD.left"
        :x2="VIEW_WIDTH - PAD.right"
        :y1="yFor(tick)"
        :y2="yFor(tick)"
      />
      <text v-for="tick in gridTicks" :key="`label-${tick}`" class="axis-label" :x="PAD.left - 6" :y="yFor(tick) + 3" text-anchor="end">
        {{ tick.toFixed(1) }}
      </text>

      <!-- block-threshold reference line -->
      <line class="threshold-line" :x1="PAD.left" :x2="VIEW_WIDTH - PAD.right" :y1="thresholdY" :y2="thresholdY" />
      <text class="threshold-label" :x="VIEW_WIDTH - PAD.right" :y="thresholdY - 4" text-anchor="end">
        Block threshold ({{ BLOCK_THRESHOLD }})
      </text>

      <!-- area + line -->
      <path v-if="areaPath" class="area" :d="areaPath" />
      <path v-if="linePath" class="line" :d="linePath" />

      <!-- end markers -->
      <circle v-for="(p, i) in points" :key="i" class="marker" :cx="p.x" :cy="p.y" r="4" />

      <!-- direct label: value at the end -->
      <text v-if="lastPoint" class="end-label" :x="lastPoint.x" :y="lastPoint.y - 10" text-anchor="middle">
        {{ lastPoint.score.toFixed(2) }}
      </text>

      <!-- x-axis: first/last timestamps -->
      <text v-if="points.length" class="axis-label" :x="PAD.left" :y="height - 6" text-anchor="start">
        {{ formatTime(points[0].timestamp) }}
      </text>
      <text v-if="points.length > 1" class="axis-label" :x="VIEW_WIDTH - PAD.right" :y="height - 6" text-anchor="end">
        {{ formatTime(points[points.length - 1].timestamp) }}
      </text>

      <!-- hover crosshair -->
      <g v-if="hoverPoint">
        <line class="crosshair" :x1="hoverPoint.x" :x2="hoverPoint.x" :y1="PAD.top" :y2="PAD.top + innerHeight" />
        <circle class="marker marker--hover" :cx="hoverPoint.x" :cy="hoverPoint.y" r="5" />
      </g>
    </svg>

    <div
      v-if="hoverPoint"
      class="tooltip"
      :style="{ left: `${(hoverPoint.x / VIEW_WIDTH) * 100}%`, top: `${(hoverPoint.y / height) * 100}%` }"
    >
      <strong>{{ hoverPoint.score.toFixed(2) }}</strong>
      <span>{{ formatTime(hoverPoint.timestamp) }}</span>
    </div>

    <ul class="sr-only">
      <li v-for="(d, i) in data" :key="i">{{ formatTime(d.timestamp) }}: {{ d.score.toFixed(2) }}</li>
    </ul>
  </div>
</template>

<style scoped>
.anomaly-chart {
  position: relative;
}
svg {
  width: 100%;
  height: auto;
  display: block;
  cursor: crosshair;
}
.gridline {
  stroke: var(--border);
  stroke-width: 1;
}
.axis-label {
  fill: var(--text);
  font-size: 10px;
  font-family: var(--sans);
  opacity: 0.75;
}
.threshold-line {
  stroke: var(--status-warning);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  opacity: 0.6;
}
.threshold-label {
  fill: var(--status-warning);
  font-size: 10px;
  font-family: var(--sans);
}
.area {
  fill: var(--accent);
  opacity: 0.1;
  stroke: none;
}
.line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.marker {
  fill: var(--accent);
  stroke: var(--surface);
  stroke-width: 2;
}
.marker--hover {
  fill: var(--text-h);
}
.end-label {
  fill: var(--text-h);
  font-size: 12px;
  font-weight: 600;
  font-family: var(--sans);
}
.crosshair {
  stroke: var(--text);
  stroke-width: 1;
  opacity: 0.4;
}
.tooltip {
  position: absolute;
  transform: translate(-50%, -130%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  padding: var(--space-1) var(--space-2);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  pointer-events: none;
  white-space: nowrap;
}
.tooltip strong {
  color: var(--text-h);
}
.tooltip span {
  color: var(--text);
}
</style>
