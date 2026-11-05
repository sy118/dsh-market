/** Small inline icon set; no external icon package. */
import { h } from './common.js'

/** Shared SVG frame. */
function glyph(size, children, label) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    'aria-hidden': label === undefined ? 'true' : undefined,
    role: label === undefined ? undefined : 'img',
    'aria-label': label,
    focusable: 'false',
  }, children)
}

/** Sidebar glyph: a stack of stages. */
export function WorkbenchIcon(props) {
  const size = typeof props.size === 'number' ? props.size : 18
  return glyph(size, [
    h('path', { key: 'a', d: 'M10 2.6 17 6.6 10 10.6 3 6.6 10 2.6Z', stroke: 'currentColor', strokeWidth: '1.5', strokeLinejoin: 'round' }),
    h('path', { key: 'b', d: 'M3 10.4 10 14.4 17 10.4', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { key: 'c', d: 'M3 14.1 10 18.1 17 14.1', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round', opacity: '0.55' }),
  ])
}

/** Grid glyph for the overview. */
export function OverviewIcon() {
  return glyph(16, [
    h('rect', { key: 'a', x: '2.5', y: '2.5', width: '6', height: '6', rx: '1.4', stroke: 'currentColor', strokeWidth: '1.4' }),
    h('rect', { key: 'b', x: '11.5', y: '2.5', width: '6', height: '6', rx: '1.4', stroke: 'currentColor', strokeWidth: '1.4' }),
    h('rect', { key: 'c', x: '2.5', y: '11.5', width: '6', height: '6', rx: '1.4', stroke: 'currentColor', strokeWidth: '1.4' }),
    h('rect', { key: 'd', x: '11.5', y: '11.5', width: '6', height: '6', rx: '1.4', stroke: 'currentColor', strokeWidth: '1.4' }),
  ])
}

/** Folder glyph for projects. */
export function ProjectsIcon() {
  return glyph(16, h('path', {
    d: 'M2.5 5.5c0-1 .8-1.8 1.8-1.8h3.1l1.6 1.8h5.7c1 0 1.8.8 1.8 1.8v5.4c0 1-.8 1.8-1.8 1.8H4.3c-1 0-1.8-.8-1.8-1.8V5.5Z',
    stroke: 'currentColor',
    strokeWidth: '1.4',
    strokeLinejoin: 'round',
  }))
}

/** Magnifier for research. */
export function ResearchIcon() {
  return glyph(16, [
    h('circle', { key: 'a', cx: '8.5', cy: '8.5', r: '4.6', stroke: 'currentColor', strokeWidth: '1.4' }),
    h('path', { key: 'b', d: 'm12 12 4 4', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
  ])
}

/** Page glyph for documents. */
export function DocsIcon() {
  return glyph(16, [
    h('path', { key: 'a', d: 'M5 2.8h6.2L15 6.6v10.6H5V2.8Z', stroke: 'currentColor', strokeWidth: '1.4', strokeLinejoin: 'round' }),
    h('path', { key: 'b', d: 'M11 2.8v4h4M7.5 10.5h5M7.5 13.5h3.5', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
  ])
}

/** Bulb glyph for opportunities. */
export function OpportunityIcon() {
  return glyph(16, [
    h('path', { key: 'a', d: 'M10 2.5a5 5 0 0 1 2.7 9.2c-.5.3-.7.8-.7 1.3v.5H8v-.5c0-.5-.2-1-.7-1.3A5 5 0 0 1 10 2.5Z', stroke: 'currentColor', strokeWidth: '1.4', strokeLinejoin: 'round' }),
    h('path', { key: 'b', d: 'M8.4 16h3.2', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
  ])
}

/** Calendar glyph for meetings. */
export function MeetingIcon() {
  return glyph(16, [
    h('rect', { key: 'a', x: '3', y: '4.5', width: '14', height: '12', rx: '2', stroke: 'currentColor', strokeWidth: '1.4' }),
    h('path', { key: 'b', d: 'M3 8.5h14M6.5 2.5v4M13.5 2.5v4', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
  ])
}

/** Refresh arrows. */
export function RefreshIcon() {
  return glyph(16, [
    h('path', { key: 'a', d: 'M15.5 8.5a5.5 5.5 0 1 1-1.7-4', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
    h('path', { key: 'b', d: 'M15.8 2.8v4h-4', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
  ])
}

/** Sparkle for AI actions. */
export function SparkIcon() {
  return glyph(16, [
    h('path', { key: 'a', d: 'M8.5 2.5 10 6.8l4.3 1.5-4.3 1.5-1.5 4.3-1.5-4.3L2.7 8.3 7 6.8Z', stroke: 'currentColor', strokeWidth: '1.4', strokeLinejoin: 'round' }),
    h('path', { key: 'b', d: 'M14.5 12.5 15.2 14.6 17.3 15.3 15.2 16 14.5 18.1 13.8 16 11.7 15.3 13.8 14.6Z', fill: 'currentColor' }),
  ])
}

/** Arrow leaving a box, for handoff. */
export function HandoffIcon() {
  return glyph(16, [
    h('path', { key: 'a', d: 'M7.5 3H4.2C3.5 3 3 3.5 3 4.2v11.6c0 .7.5 1.2 1.2 1.2h11.6c.7 0 1.2-.5 1.2-1.2v-3.3', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
    h('path', { key: 'b', d: 'M11 3h6v6M17 3l-7.5 7.5', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }),
  ])
}

/** Plus. */
export function PlusIcon() {
  return glyph(14, h('path', { d: 'M10 3.5v13M3.5 10h13', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }))
}

/** Trash. */
export function TrashIcon() {
  return glyph(14, [
    h('path', { key: 'a', d: 'M4 6h12M8 3h4M6.5 6l.8 11h5.4l.8-11', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { key: 'b', d: 'M8.8 9v5M11.2 9v5', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
  ])
}

/** Check. */
export function CheckIcon() {
  return glyph(14, h('path', { d: 'm3.5 10.5 4 4 9-9', stroke: 'currentColor', strokeWidth: '1.7', strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

/** Small close. */
export function CloseIcon() {
  return glyph(14, h('path', { d: 'm5 5 10 10M15 5 5 15', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }))
}

/** Send. */
export function SendIcon() {
  return glyph(15, h('path', { d: 'M3 10 17 3.8 12.2 17l-2.4-5.2L3 10Z', stroke: 'currentColor', strokeWidth: '1.4', strokeLinejoin: 'round' }))
}

/** Stop. */
export function StopIcon() {
  return glyph(14, h('rect', { x: '4.5', y: '4.5', width: '11', height: '11', rx: '2', fill: 'currentColor' }))
}

/** Chevron. */
export function ChevronIcon(props) {
  return glyph(12, h('path', {
    d: props.direction === 'up' ? 'm4 13 6-6 6 6' : 'm4 7 6 6 6-6',
    stroke: 'currentColor',
    strokeWidth: '1.6',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }))
}

/** Edit pencil. */
export function EditIcon() {
  return glyph(14, h('path', { d: 'M3 17h4L17 7l-4-4L3 13v4Z', stroke: 'currentColor', strokeWidth: '1.4', strokeLinejoin: 'round' }))
}

/** Copy. */
export function CopyIcon() {
  return glyph(14, [
    h('rect', { key: 'a', x: '7', y: '7', width: '10', height: '10', rx: '1.6', stroke: 'currentColor', strokeWidth: '1.3' }),
    h('path', { key: 'b', d: 'M13 7V4.6c0-.9-.7-1.6-1.6-1.6H4.6C3.7 3 3 3.7 3 4.6v6.8C3 12.3 3.7 13 4.6 13H7', stroke: 'currentColor', strokeWidth: '1.3' }),
  ])
}
