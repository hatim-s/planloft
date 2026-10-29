// Element builder for the runtime UI. Text always goes through text nodes, never HTML
// parsing, so comment and note bodies cannot inject markup.

type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === 'value' && element instanceof HTMLTextAreaElement) element.value = String(value);
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

const SVG = 'http://www.w3.org/2000/svg';

/** A 20px stroke icon from path data. */
export function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'plc-icon');
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export const ICONS = {
  comment: ['M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5z'],
  close: ['M5 5l10 10M15 5L5 15'],
  check: ['M4.5 10.5l3.5 3.5 7.5-8'],
  back: ['M12 5l-5 5 5 5'],
  send: ['M10 15.5V5', 'M5.5 9.5L10 5l4.5 4.5'],
  plus: ['M10 4.5v11M4.5 10h11'],
  trash: ['M3.5 5.5h13', 'M7 5.5V3.5h6v2', 'M5 5.5l.8 11h8.4l.8-11', 'M8 8.5v5M12 8.5v5'],
  reopen: ['M4.5 10a5.5 5.5 0 1 0 1.6-3.9', 'M4.5 3.5v3h3'],
  warning: ['M10 3l8 14H2z', 'M10 8.5v3.5M10 14.5v.01'],
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity]];

/** A <time> element with relative text computed at render time; no timer refreshes it. */
export function time(iso: string): HTMLTimeElement {
  const date = new Date(iso);
  let value = (date.getTime() - Date.now()) / 1000;
  let label = '';
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) {
      label = unit === 'second' ? relative.format(0, 'second') : relative.format(Math.round(value), unit);
      break;
    }
    value /= size;
  }
  return h('time', { datetime: iso, title: absolute.format(date) }, label);
}
