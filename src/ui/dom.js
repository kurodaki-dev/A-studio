import {
  createElement,
  Play,
  Pause,
  Square,
  Menu,
  Undo2,
  Redo2,
  Pencil,
  Paintbrush,
  Eraser,
  SquareDashed,
  Scissors,
  Hand,
  Magnet,
  ZoomIn,
  ZoomOut,
  Piano,
  SlidersVertical,
  LayoutList,
  Grid3x3,
  FolderOpen,
  Save,
  Download,
  Upload,
  Plus,
  Minus,
  X,
  Copy,
  ClipboardPaste,
  CopyPlus,
  Trash,
  Settings,
  Drum,
  AudioLines,
  AudioWaveform,
  Guitar,
  Wind,
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  Metronome,
  FilePlus,
  Share2,
  Info,
  Shield,
  FileText,
  Cookie,
  ListMusic,
  Volume2,
  Music,
  ArrowUp,
  ArrowDown,
  Check,
  Palette,
  Puzzle,
  BookOpen,
  Bug,
  ExternalLink,
  Lightbulb,
  RefreshCw,
  Search,
  GitBranch,
  Circle,
  FileMusic,
  Bot,
  Headphones,
  Shuffle,
  Keyboard,
  WandSparkles,
  FileArchive,
  Pointer,
  NotebookPen,
  Timer,
  LayoutGrid,
  Columns3,
  Repeat,
  Flag,
  Activity,
  Mic,
  Cpu,
  ArrowRight,
  Layers,
  Funnel,
  Tag,
  Slice,
} from 'lucide';
import { t } from '../i18n.js';

const ICONS = {
  Play, Pause, Square, Menu, Undo2, Redo2, Pencil, Paintbrush, Eraser, SquareDashed, Scissors, Hand, Magnet,
  ZoomIn, ZoomOut, Piano, SlidersVertical, LayoutList, Grid3x3, FolderOpen, Save, Download, Upload, Plus, Minus,
  X, Copy, ClipboardPaste, CopyPlus, Trash, Settings, Drum, AudioLines, AudioWaveform, Guitar, Wind, Bell,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Metronome, FilePlus, Share2, Info,
  Shield, FileText, Cookie, ListMusic, Volume2, Music, ArrowUp, ArrowDown, Check, Palette, Puzzle, BookOpen, Bug, ExternalLink, Lightbulb, RefreshCw, Search, GitBranch, Circle, FileMusic, Bot,
  Headphones, Shuffle, Keyboard, WandSparkles, FileArchive, Pointer, NotebookPen, Timer, LayoutGrid, Columns3,
  Repeat, Flag, Activity, Mic, Cpu, ArrowRight, Layers, Funnel, Tag, Slice,
};

export function icon(name, size = 18) {
  const node = ICONS[name] || ICONS.Music;
  return createElement(node, { width: size, height: size, 'stroke-width': 2, class: 'ic', 'aria-hidden': 'true' });
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function btn(iconName, title, onClick, cls = '') {
  return h('button', { class: 'b ' + cls, title, 'aria-label': title, type: 'button', onClick }, icon(iconName));
}

export function textBtn(label, onClick, cls = '') {
  return h('button', { class: 'b tb ' + cls, type: 'button', onClick }, label);
}

// Hint bar, like the one in FL Studio's toolbar.
let hintEl = null;
let hintTimer = null;
export function bindHint(el) {
  hintEl = el;
}
export function hint(text) {
  if (!hintEl) return;
  hintEl.textContent = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (hintEl) hintEl.textContent = '';
  }, 4000);
}

// Popup menu. items: {label, icon, onClick, checked, disabled} or {sep: true}
let openMenuEl = null;
export function closeMenu() {
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
    document.removeEventListener('pointerdown', outside, true);
  }
}
function outside(e) {
  if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu();
}
export function openMenu(anchor, items) {
  closeMenu();
  const menu = h(
    'div',
    { class: 'menu', role: 'menu' },
    items.map((it) =>
      it.sep
        ? h('div', { class: 'menu-sep' })
        : it.header
        ? h('div', { class: 'menu-header' }, it.header)
        : h(
            'button',
            {
              class: 'menu-item' + (it.checked ? ' checked' : ''),
              type: 'button',
              role: 'menuitem',
              disabled: !!it.disabled,
              onClick: () => {
                closeMenu();
                it.onClick && it.onClick();
              },
            },
            h('span', { class: 'menu-ic' }, it.checked ? icon('Check', 14) : it.icon ? icon(it.icon, 14) : null),
            h('span', null, it.label),
          ),
    ),
  );
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let x = r.left;
  let y = r.bottom + 2;
  if (x + mw > window.innerWidth - 4) x = Math.max(4, window.innerWidth - mw - 4);
  if (y + mh > window.innerHeight - 4) y = Math.max(4, r.top - mh - 2);
  if (y + mh > window.innerHeight - 4) y = Math.max(4, window.innerHeight - mh - 4);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  openMenuEl = menu;
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

// Modal dialog. actions: [{label, primary, onClick}] ; onClick returning false keeps it open.
export function openModal({ title, body, actions = [{ label: t('Close'), primary: true }], wide = false, onClose }) {
  closeMenu();
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const dialog = h(
    'div',
    { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'dialog-title' }, h('span', null, title), btn('X', t('Close'), () => close(), 'ghost')),
    h('div', { class: 'dialog-body' }, body),
    actions.length
      ? h(
          'div',
          { class: 'dialog-actions' },
          actions.map((a) =>
            h(
              'button',
              {
                class: 'b tb' + (a.primary ? ' primary' : ''),
                type: 'button',
                onClick: async () => {
                  const r = a.onClick ? await a.onClick() : undefined;
                  if (r !== false) close();
                },
              },
              a.label,
            ),
          ),
        )
      : null,
  );
  const overlay = h('div', {
    class: 'overlay',
    onPointerdown: (e) => {
      if (e.target === overlay) close();
    },
  });
  overlay.append(dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  return { close, dialog };
}

export function promptText(title, value = '') {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', type: 'text', value, maxlength: 80 });
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const m = openModal({
      title,
      body: input,
      actions: [
        { label: t('Cancel'), onClick: () => finish(null) },
        { label: t('OK'), primary: true, onClick: () => finish(input.value.trim() || null) },
      ],
      onClose: () => finish(null),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finish(input.value.trim() || null);
        m.close();
      }
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

export function confirmBox(title, text, okLabel = t('Confirm')) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    openModal({
      title,
      body: h('p', null, text),
      actions: [
        { label: t('Cancel'), onClick: () => finish(false) },
        { label: okLabel, primary: true, onClick: () => finish(true) },
      ],
      onClose: () => finish(false),
    });
  });
}

export function alertBox(title, text) {
  openModal({ title, body: h('p', null, text) });
}

// Flat dropdown that opens a menu, used instead of the native <select>.
// options: [{ value, label, group }]
export function dropdown({ options, value, onChange, label, cls = '' }) {
  let cur = value;
  let opts = options;
  const text = h('span', { class: 'dd-text' });
  const el = h('button', { class: 'b dd ' + cls, type: 'button', 'aria-haspopup': 'menu', 'aria-label': label, title: label }, text, icon('ChevronDown', 14));
  const show = () => {
    const o = opts.find((x) => x.value === cur);
    text.textContent = o ? o.label : '';
  };
  el.addEventListener('click', () => {
    const items = [];
    let group = null;
    for (const o of opts) {
      if (o.group && o.group !== group) {
        if (items.length) items.push({ sep: true });
        items.push({ header: o.group });
        group = o.group;
      }
      items.push({ label: o.label, checked: o.value === cur, onClick: () => {
        cur = o.value;
        show();
        onChange(o.value);
      } });
    }
    openMenu(el, items);
  });
  el.setValue = (v) => {
    cur = v;
    show();
  };
  el.setOptions = (list, v = cur) => {
    opts = list;
    cur = v;
    show();
  };
  show();
  return el;
}
