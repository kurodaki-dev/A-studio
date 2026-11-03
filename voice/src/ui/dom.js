// Small DOM helpers of A Voice Studio: elements, icons (the same Lucide icons as
// A Studio), menus, dialogs and hints.
import {
  createElement, Play, Square, Repeat, Plus, Minus, X, Trash2, Pencil, MousePointer2, Eraser, Spline, ZoomIn, ZoomOut,
  Mic, AudioWaveform, Music, Piano, FolderOpen, Save, Download, Upload, Settings, Puzzle, Palette, Search, Undo2, Redo2,
  Volume2, VolumeX, Headphones, Sparkles, WandSparkles, Languages, ListMusic, Bot, Server, Package, Info, ChevronDown,
  ChevronRight, ChevronLeft, PanelLeft, PanelRight, Send, FileMusic, Copy, ClipboardPaste, Scissors, Layers, Check,
  RefreshCw, Activity, SlidersVertical, BookOpen, Wind, Gauge, User, Type, Keyboard, CircleHelp, Magnet, Menu,
} from 'lucide';
import { t } from '../i18n.js';

const ICONS = {
  Play, Square, Repeat, Plus, Minus, X, Trash2, Pencil, MousePointer2, Eraser, Spline, ZoomIn, ZoomOut, Mic, AudioWaveform,
  Music, Piano, FolderOpen, Save, Download, Upload, Settings, Puzzle, Palette, Search, Undo2, Redo2, Volume2, VolumeX,
  Headphones, Sparkles, WandSparkles, Languages, ListMusic, Bot, Server, Package, Info, ChevronDown, ChevronRight, ChevronLeft,
  PanelLeft, PanelRight, Send, FileMusic, Copy, ClipboardPaste, Scissors, Layers, Check, RefreshCw, Activity, SlidersVertical,
  BookOpen, Wind, Gauge, User, Type, Keyboard, CircleHelp, Magnet, Menu,
};

export function icon(name, size = 16) {
  return createElement(ICONS[name] || ICONS.Music, { width: size, height: size, 'stroke-width': 2, class: 'ic', 'aria-hidden': 'true' });
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function iconBtn(ic, label, onClick, cls = '') {
  return h('button', { class: 'ib ' + cls, type: 'button', title: label, 'aria-label': label, onClick }, icon(ic));
}

export function textBtn(label, onClick, cls = '', ic = null) {
  return h('button', { class: 'tb ' + cls, type: 'button', onClick }, ic ? icon(ic, 16) : null, label);
}

let hintEl = null;
let hintTimer = null;
export function setHintEl(el) {
  hintEl = el;
}
export function hint(text, ms = 2600) {
  if (!hintEl) return;
  hintEl.textContent = text;
  hintEl.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.remove('show'), ms);
}

// Menu at an element (or {x, y}). items: [{ label, icon, onClick, checked, disabled, sep, header }].
let menuEl = null;
function outside(e) {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
}
export function closeMenu() {
  if (menuEl) menuEl.remove();
  menuEl = null;
  document.removeEventListener('pointerdown', outside, true);
}
export function openMenu(anchor, items) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) => {
    if (it.sep) return h('div', { class: 'menu-sep' });
    if (it.header) return h('div', { class: 'menu-head' }, it.header);
    return h('button', {
      class: 'menu-item' + (it.checked ? ' checked' : ''), type: 'button', role: 'menuitem', disabled: !!it.disabled,
      onClick: () => { closeMenu(); it.onClick && it.onClick(); },
    }, it.icon ? icon(it.icon, 16) : h('span', { class: 'menu-space' }), h('span', null, it.label), it.checked ? icon('Check', 14) : null, it.key ? h('kbd', null, it.key) : null);
  }));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let x = r.left;
  let y = r.bottom + 2;
  if (x + mw > innerWidth - 4) x = Math.max(4, innerWidth - mw - 4);
  if (y + mh > innerHeight - 4) y = Math.max(4, r.top - mh - 2);
  if (y + mh > innerHeight - 4) y = Math.max(4, innerHeight - mh - 4);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menuEl = menu;
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

// Dialog. actions: [{ label, primary, onClick }] (onClick returning false keeps it open).
export function openModal({ title, body, actions = [{ label: t('Close'), primary: true }], wide = false, onClose }) {
  closeMenu();
  const close = () => {
    ov.remove();
    document.removeEventListener('keydown', key);
    onClose && onClose();
  };
  const key = (e) => { if (e.key === 'Escape') close(); };
  const dlg = h('div', { class: 'dlg' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'dlg-title' }, h('span', null, title), iconBtn('X', t('Close'), close)),
    h('div', { class: 'dlg-body' }, body),
    actions.length ? h('div', { class: 'dlg-actions' }, actions.map((a) => h('button', {
      class: 'tb' + (a.primary ? ' primary' : ''), type: 'button',
      onClick: async () => { const r = a.onClick ? await a.onClick() : undefined; if (r !== false) close(); },
    }, a.label))) : null);
  const ov = h('div', { class: 'overlay', onPointerdown: (e) => { if (e.target === ov) close(); } }, dlg);
  document.body.append(ov);
  document.addEventListener('keydown', key);
  return { close, el: dlg };
}

export function alertBox(title, text) {
  return new Promise((resolve) => openModal({ title, body: h('p', { class: 'pre' }, text), onClose: resolve }));
}

export function confirmBox(title, text, yes = t('OK')) {
  return new Promise((resolve) => {
    let done = false;
    openModal({ title, body: h('p', null, text), actions: [{ label: t('Cancel') }, { label: yes, primary: true, onClick: () => { done = true; } }], onClose: () => resolve(done) });
  });
}

export function promptText(title, value = '', placeholder = '') {
  return new Promise((resolve) => {
    let res = null;
    const input = h('input', { class: 'input', value, placeholder, 'aria-label': title });
    const m = openModal({ title, body: input, actions: [{ label: t('Cancel') }, { label: t('OK'), primary: true, onClick: () => { res = input.value; } }], onClose: () => resolve(res) });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { res = input.value; m.close(); } });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

// Select element styled for the app.
export function select({ value, options, onChange, label, cls = '' }) {
  const s = h('select', { class: 'sel ' + cls, 'aria-label': label, onChange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  s.setOptions = (opts, v) => {
    s.replaceChildren(...opts.map((o) => h('option', { value: o.value, selected: String(o.value) === String(v) }, o.label)));
  };
  return s;
}

export function slider({ label, min, max, step = 1, value, format = (v) => String(v), onStart, onInput, def }) {
  const out = h('output', null, format(value));
  const input = h('input', { type: 'range', class: 'range', min, max, step, value, 'aria-label': label,
    onPointerdown: () => onStart && onStart(),
    onInput: (e) => { const v = Number(e.target.value); out.textContent = format(v); onInput(v); },
    onDblclick: (e) => { if (def == null) return; onStart && onStart(); e.target.value = def; out.textContent = format(def); onInput(def); },
  });
  return h('label', { class: 'field' }, h('span', null, label), h('div', { class: 'rangebox' }, input, out));
}

// Picks files with the system dialog. Resolves to File[].
export function pickFiles(accept = '', multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...(input.files || [])]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function download(name, bytes, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
